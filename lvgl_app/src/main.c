#include "lvgl.h"
#include "generated/screen_workspace_config.h"
#ifndef WALNUT_LVGL_NO_FBDEV
#include "src/drivers/display/fb/lv_linux_fbdev.h"
#endif

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>

#if defined(__linux__) && !defined(WALNUT_LVGL_NO_FBDEV)
#include <signal.h>
#include <unistd.h>
#endif

static volatile bool running = true;

#define WALNUT_SCREEN_WIDTH 480
#define WALNUT_SCREEN_HEIGHT 320
#define WALNUT_SCREEN_STRIDE (WALNUT_SCREEN_WIDTH * 2)
#define WALNUT_RUNTIME_MAX_FRAMES 80
#define WALNUT_RUNTIME_MAX_ITEMS 32
#define WALNUT_RUNTIME_PATH_MAX 256

typedef struct {
    lv_obj_t * image;
    int item;
    int repeat;
    int frame;
    bool stopped;
} workspace_ui_t;

static workspace_ui_t workspace_ui;

typedef struct {
    lv_image_dsc_t image;
    char path[WALNUT_RUNTIME_PATH_MAX];
    char file_sha256[65];
    char rgba_pixel_sha256[65];
    char rgb565_pixel_sha256[65];
    int duration_ms;
} runtime_frame_t;

typedef struct {
    char manifest_id[80];
    char manifest_hash[65];
    char output_type[16];
    int first_frame;
    int frame_count;
    int duration_ms;
    int repeat;
    char transition[16];
} runtime_item_t;

typedef struct {
    bool loaded;
    bool loop;
    int frame_count;
    int item_count;
    char playlist_id[80];
    char playlist_hash[65];
    char root_dir[WALNUT_RUNTIME_PATH_MAX];
    runtime_frame_t frames[WALNUT_RUNTIME_MAX_FRAMES];
    runtime_item_t items[WALNUT_RUNTIME_MAX_ITEMS];
} runtime_workspace_t;

static runtime_workspace_t runtime_workspace;
static uint8_t runtime_frame_pixels[WALNUT_SCREEN_WIDTH * WALNUT_SCREEN_HEIGHT * 2];
static bool runtime_frame_valid = false;
static const char walnut_runtime_assets_schema_marker[] = "walnutpi.lvgl-runtime-assets.v1";

static void handle_signal(int sig)
{
    (void)sig;
    running = false;
}

static int clamp_int(int value, int low, int high)
{
    if(value < low) return low;
    if(value > high) return high;
    return value;
}

static void copy_token(char * dst, size_t dst_size, const char * src)
{
    if(dst == NULL || dst_size == 0) return;
    if(src == NULL) src = "";
    snprintf(dst, dst_size, "%s", src);
}

static bool dirname_from_path(const char * path_value, char * dst, size_t dst_size)
{
    const char * slash = strrchr(path_value, '/');
#if defined(_WIN32)
    const char * backslash = strrchr(path_value, '\\');
    if(backslash != NULL && (slash == NULL || backslash > slash)) slash = backslash;
#endif
    if(slash == NULL) {
        copy_token(dst, dst_size, ".");
        return true;
    }
    size_t length = (size_t)(slash - path_value);
    if(length + 1 > dst_size) return false;
    memcpy(dst, path_value, length);
    dst[length] = '\0';
    return true;
}

static void path_join(char * dst, size_t dst_size, const char * dir, const char * child)
{
    if(child != NULL && child[0] == '/') {
        copy_token(dst, dst_size, child);
        return;
    }
    snprintf(dst, dst_size, "%s/%s", dir, child ? child : "");
}

static bool read_runtime_frame_pixels(runtime_frame_t * frame)
{
    if(frame == NULL) return false;
    FILE * file = fopen(frame->path, "rb");
    if(file == NULL) return false;
    size_t expected = sizeof(runtime_frame_pixels);
    size_t read_bytes = fread(runtime_frame_pixels, 1, expected, file);
    int extra = fgetc(file);
    fclose(file);
    if(read_bytes != expected || extra != EOF) {
        runtime_frame_valid = false;
        return false;
    }
    frame->image.data = runtime_frame_pixels;
    frame->image.data_size = expected;
    runtime_frame_valid = true;
    return true;
}

static bool parse_runtime_workspace(const char * index_path)
{
    FILE * file = fopen(index_path, "r");
    if(file == NULL) return false;

    memset(&runtime_workspace, 0, sizeof(runtime_workspace));
    if(!dirname_from_path(index_path, runtime_workspace.root_dir, sizeof(runtime_workspace.root_dir))) {
        fclose(file);
        return false;
    }

    char line[768];
    while(fgets(line, sizeof(line), file) != NULL) {
        char * newline = strchr(line, '\n');
        if(newline != NULL) *newline = '\0';
        if(line[0] == '\0' || line[0] == '#') continue;

        char * fields[12] = {0};
        int count = 0;
        char * token = strtok(line, " \t\r");
        while(token != NULL && count < 12) {
            fields[count++] = token;
            token = strtok(NULL, " \t\r");
        }
        if(count == 0) continue;

        if(strcmp(fields[0], "schema") == 0 && count >= 2 && strcmp(fields[1], walnut_runtime_assets_schema_marker) != 0) {
            fclose(file);
            memset(&runtime_workspace, 0, sizeof(runtime_workspace));
            return false;
        }
        else if(strcmp(fields[0], "playlistId") == 0 && count >= 2) {
            copy_token(runtime_workspace.playlist_id, sizeof(runtime_workspace.playlist_id), fields[1]);
        }
        else if(strcmp(fields[0], "playlistHash") == 0 && count >= 2) {
            copy_token(runtime_workspace.playlist_hash, sizeof(runtime_workspace.playlist_hash), fields[1]);
        }
        else if(strcmp(fields[0], "loop") == 0 && count >= 2) {
            runtime_workspace.loop = atoi(fields[1]) != 0;
        }
        else if(strcmp(fields[0], "frame") == 0 && count >= 7) {
            int index = atoi(fields[1]);
            if(index < 0 || index >= WALNUT_RUNTIME_MAX_FRAMES) continue;
            runtime_frame_t * frame = &runtime_workspace.frames[index];
            frame->duration_ms = atoi(fields[2]);
            copy_token(frame->file_sha256, sizeof(frame->file_sha256), fields[3]);
            copy_token(frame->rgba_pixel_sha256, sizeof(frame->rgba_pixel_sha256), fields[4]);
            copy_token(frame->rgb565_pixel_sha256, sizeof(frame->rgb565_pixel_sha256), fields[5]);
            path_join(frame->path, sizeof(frame->path), runtime_workspace.root_dir, fields[6]);
            frame->image.header.magic = LV_IMAGE_HEADER_MAGIC;
            frame->image.header.cf = LV_COLOR_FORMAT_RGB565;
            frame->image.header.flags = 0;
            frame->image.header.w = WALNUT_SCREEN_WIDTH;
            frame->image.header.h = WALNUT_SCREEN_HEIGHT;
            frame->image.header.stride = WALNUT_SCREEN_STRIDE;
            frame->image.header.reserved_2 = 0;
            frame->image.reserved = NULL;
            if(index + 1 > runtime_workspace.frame_count) runtime_workspace.frame_count = index + 1;
        }
        else if(strcmp(fields[0], "item") == 0 && count >= 10) {
            int index = atoi(fields[1]);
            if(index < 0 || index >= WALNUT_RUNTIME_MAX_ITEMS) continue;
            runtime_item_t * item = &runtime_workspace.items[index];
            copy_token(item->manifest_id, sizeof(item->manifest_id), fields[2]);
            copy_token(item->manifest_hash, sizeof(item->manifest_hash), fields[3]);
            copy_token(item->output_type, sizeof(item->output_type), fields[4]);
            item->first_frame = atoi(fields[5]);
            item->frame_count = atoi(fields[6]);
            item->duration_ms = atoi(fields[7]);
            item->repeat = atoi(fields[8]);
            copy_token(item->transition, sizeof(item->transition), fields[9]);
            if(index + 1 > runtime_workspace.item_count) runtime_workspace.item_count = index + 1;
        }
    }
    fclose(file);

    runtime_workspace.loaded =
        runtime_workspace.playlist_hash[0] != '\0'
        && runtime_workspace.frame_count > 0
        && runtime_workspace.item_count > 0;
    return runtime_workspace.loaded;
}

bool walnut_screen_workspace_load_runtime(const char * index_path)
{
    if(index_path == NULL || index_path[0] == '\0') return false;
    return parse_runtime_workspace(index_path);
}

const char * walnut_screen_workspace_active_playlist_hash(void)
{
    if(runtime_workspace.loaded) return runtime_workspace.playlist_hash;
    return walnut_screen_workspace_config_playlist_hash();
}

static bool workspace_playlist_enabled(void)
{
    if(runtime_workspace.loaded) return runtime_workspace.item_count > 0 && runtime_workspace.frame_count > 0;
    return WALNUT_SCREEN_WORKSPACE_ITEM_COUNT > 0 && WALNUT_SCREEN_WORKSPACE_FRAME_COUNT > 0;
}

static int workspace_frame_duration_ms(int item_index, int frame_index)
{
    if(runtime_workspace.loaded) {
        if(item_index < 0 || item_index >= runtime_workspace.item_count) return 1000;
        const runtime_item_t * item = &runtime_workspace.items[item_index];
        if(item->frame_count <= 1) return clamp_int(item->duration_ms, 1, 86400000);
        if(frame_index < 0 || frame_index >= runtime_workspace.frame_count) return 1000;
        return clamp_int(runtime_workspace.frames[frame_index].duration_ms, 1, 600000);
    }
    if(item_index < 0 || item_index >= WALNUT_SCREEN_WORKSPACE_ITEM_COUNT) return 1000;
    const walnut_screen_workspace_item_config_t * item = &walnut_screen_workspace_items[item_index];
    if(item->frame_count <= 1) return clamp_int(item->duration_ms, 1, 86400000);
    if(frame_index < 0 || frame_index >= WALNUT_SCREEN_WORKSPACE_FRAME_COUNT) return 1000;
    return clamp_int(walnut_screen_workspace_frames[frame_index].duration_ms, 1, 600000);
}

static void workspace_apply_frame(workspace_ui_t * ui)
{
    if(ui == NULL || ui->image == NULL || !workspace_playlist_enabled()) return;
    if(runtime_workspace.loaded) {
        ui->item = clamp_int(ui->item, 0, runtime_workspace.item_count - 1);
        const runtime_item_t * item = &runtime_workspace.items[ui->item];
        int first_frame = clamp_int(item->first_frame, 0, runtime_workspace.frame_count - 1);
        int frame_count = clamp_int(item->frame_count, 1, runtime_workspace.frame_count - first_frame);
        ui->frame = clamp_int(ui->frame, first_frame, first_frame + frame_count - 1);
        runtime_frame_t * frame = &runtime_workspace.frames[ui->frame];
        if(read_runtime_frame_pixels(frame)) lv_image_set_src(ui->image, &frame->image);
        return;
    }
    ui->item = clamp_int(ui->item, 0, WALNUT_SCREEN_WORKSPACE_ITEM_COUNT - 1);
    const walnut_screen_workspace_item_config_t * item = &walnut_screen_workspace_items[ui->item];
    int first_frame = clamp_int(item->first_frame, 0, WALNUT_SCREEN_WORKSPACE_FRAME_COUNT - 1);
    int frame_count = clamp_int(item->frame_count, 1, WALNUT_SCREEN_WORKSPACE_FRAME_COUNT - first_frame);
    ui->frame = clamp_int(ui->frame, first_frame, first_frame + frame_count - 1);
    const walnut_screen_workspace_frame_config_t * frame = &walnut_screen_workspace_frames[ui->frame];
    if(frame->image != NULL) lv_image_set_src(ui->image, frame->image);
}

static void workspace_advance(workspace_ui_t * ui)
{
    if(ui == NULL || ui->stopped || !workspace_playlist_enabled()) return;
    int item_count = runtime_workspace.loaded ? runtime_workspace.item_count : WALNUT_SCREEN_WORKSPACE_ITEM_COUNT;
    int frame_total = runtime_workspace.loaded ? runtime_workspace.frame_count : WALNUT_SCREEN_WORKSPACE_FRAME_COUNT;
    int first_frame = 0;
    int frame_count = 1;
    int repeat = 1;
    if(runtime_workspace.loaded) {
        const runtime_item_t * item = &runtime_workspace.items[ui->item];
        first_frame = clamp_int(item->first_frame, 0, frame_total - 1);
        frame_count = clamp_int(item->frame_count, 1, frame_total - first_frame);
        repeat = clamp_int(item->repeat, 1, 1000);
    }
    else {
        const walnut_screen_workspace_item_config_t * item = &walnut_screen_workspace_items[ui->item];
        first_frame = clamp_int(item->first_frame, 0, frame_total - 1);
        frame_count = clamp_int(item->frame_count, 1, frame_total - first_frame);
        repeat = clamp_int(item->repeat, 1, 1000);
    }
    if(frame_count > 1 && ui->frame < first_frame + frame_count - 1) {
        ui->frame++;
        return;
    }

    ui->frame = first_frame;
    ui->repeat++;
    if(ui->repeat < repeat) return;

    ui->repeat = 0;
    if(ui->item < item_count - 1) {
        ui->item++;
    }
    else if(runtime_workspace.loaded ? runtime_workspace.loop : WALNUT_SCREEN_WORKSPACE_PLAYLIST_LOOP) {
        ui->item = 0;
    }
    else {
        ui->stopped = true;
        ui->frame = first_frame + frame_count - 1;
        return;
    }
    if(runtime_workspace.loaded) {
        const runtime_item_t * next_item = &runtime_workspace.items[ui->item];
        ui->frame = clamp_int(next_item->first_frame, 0, frame_total - 1);
    }
    else {
        const walnut_screen_workspace_item_config_t * next_item = &walnut_screen_workspace_items[ui->item];
        ui->frame = clamp_int(next_item->first_frame, 0, frame_total - 1);
    }
}

static void workspace_timer_cb(lv_timer_t * timer)
{
    workspace_ui_t * ui = (workspace_ui_t *)lv_timer_get_user_data(timer);
    if(ui == NULL || !workspace_playlist_enabled()) return;
    workspace_advance(ui);
    workspace_apply_frame(ui);
    if(ui->stopped) {
        lv_timer_pause(timer);
        return;
    }
    lv_timer_set_period(timer, workspace_frame_duration_ms(ui->item, ui->frame));
}

static void workspace_apply_time(int advance_ms)
{
    if(!workspace_playlist_enabled()) return;
    if(advance_ms < 0) advance_ms = 0;

    int total = 0;
    int item_count = runtime_workspace.loaded ? runtime_workspace.item_count : WALNUT_SCREEN_WORKSPACE_ITEM_COUNT;
    int frame_total = runtime_workspace.loaded ? runtime_workspace.frame_count : WALNUT_SCREEN_WORKSPACE_FRAME_COUNT;
    bool loop = runtime_workspace.loaded ? runtime_workspace.loop : WALNUT_SCREEN_WORKSPACE_PLAYLIST_LOOP;

    for(int item_index = 0; item_index < item_count; item_index++) {
        int first_frame = 0;
        int frame_count = 1;
        int duration_ms = 1000;
        int repeat = 1;
        if(runtime_workspace.loaded) {
            const runtime_item_t * item = &runtime_workspace.items[item_index];
            first_frame = clamp_int(item->first_frame, 0, frame_total - 1);
            frame_count = clamp_int(item->frame_count, 1, frame_total - first_frame);
            duration_ms = item->duration_ms;
            repeat = item->repeat;
        }
        else {
            const walnut_screen_workspace_item_config_t * item = &walnut_screen_workspace_items[item_index];
            first_frame = clamp_int(item->first_frame, 0, frame_total - 1);
            frame_count = clamp_int(item->frame_count, 1, frame_total - first_frame);
            duration_ms = item->duration_ms;
            repeat = item->repeat;
        }
        int cycle = 0;
        if(frame_count <= 1) {
            cycle = clamp_int(duration_ms, 1, 86400000);
        }
        else {
            for(int offset = 0; offset < frame_count; offset++) {
                cycle += workspace_frame_duration_ms(item_index, first_frame + offset);
            }
        }
        total += cycle * clamp_int(repeat, 1, 1000);
    }
    if(total <= 0) total = 1;

    int cursor = loop ? advance_ms % total : clamp_int(advance_ms, 0, total - 1);
    for(int item_index = 0; item_index < item_count; item_index++) {
        int first_frame = 0;
        int frame_count = 1;
        int duration_ms = 1000;
        int repeat = 1;
        if(runtime_workspace.loaded) {
            const runtime_item_t * item = &runtime_workspace.items[item_index];
            first_frame = clamp_int(item->first_frame, 0, frame_total - 1);
            frame_count = clamp_int(item->frame_count, 1, frame_total - first_frame);
            duration_ms = item->duration_ms;
            repeat = item->repeat;
        }
        else {
            const walnut_screen_workspace_item_config_t * item = &walnut_screen_workspace_items[item_index];
            first_frame = clamp_int(item->first_frame, 0, frame_total - 1);
            frame_count = clamp_int(item->frame_count, 1, frame_total - first_frame);
            duration_ms = item->duration_ms;
            repeat = item->repeat;
        }
        int cycle = 0;
        if(frame_count <= 1) {
            cycle = clamp_int(duration_ms, 1, 86400000);
        }
        else {
            for(int offset = 0; offset < frame_count; offset++) {
                cycle += workspace_frame_duration_ms(item_index, first_frame + offset);
            }
        }

        int item_total = cycle * clamp_int(repeat, 1, 1000);
        if(cursor >= item_total) {
            cursor -= item_total;
            continue;
        }

        workspace_ui.item = item_index;
        workspace_ui.repeat = cycle > 0 ? cursor / cycle : 0;
        int frame_cursor = cycle > 0 ? cursor % cycle : 0;
        workspace_ui.frame = first_frame;
        if(frame_count > 1) {
            for(int offset = 0; offset < frame_count; offset++) {
                int duration = workspace_frame_duration_ms(item_index, first_frame + offset);
                if(frame_cursor < duration) {
                    workspace_ui.frame = first_frame + offset;
                    break;
                }
                frame_cursor -= duration;
            }
        }
        workspace_apply_frame(&workspace_ui);
        return;
    }
}

static void build_empty_workspace_screen(void)
{
    lv_obj_t * scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_hex(0x05080b), 0);

    lv_obj_t * title = lv_label_create(scr);
    lv_label_set_text(title, "SCREEN WORKSPACE EMPTY");
    lv_obj_set_style_text_color(title, lv_color_hex(0xffd166), 0);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_24, 0);
    lv_obj_align(title, LV_ALIGN_TOP_LEFT, 18, 18);

    lv_obj_t * note = lv_label_create(scr);
    lv_label_set_text(note, "Generate screen/playlists/default.json");
    lv_obj_set_style_text_color(note, lv_color_hex(0xf4f1df), 0);
    lv_obj_set_style_text_font(note, &lv_font_montserrat_18, 0);
    lv_obj_set_width(note, 440);
    lv_label_set_long_mode(note, LV_LABEL_LONG_WRAP);
    lv_obj_align(note, LV_ALIGN_TOP_LEFT, 18, 72);

    lv_obj_t * reason = lv_label_create(scr);
    lv_label_set_text(reason, WALNUT_SCREEN_WORKSPACE_GENERATION_NOTE);
    lv_obj_set_style_text_color(reason, lv_color_hex(0x95a1a6), 0);
    lv_obj_set_style_text_font(reason, &lv_font_montserrat_14, 0);
    lv_obj_set_width(reason, 440);
    lv_label_set_long_mode(reason, LV_LABEL_LONG_WRAP);
    lv_obj_align(reason, LV_ALIGN_TOP_LEFT, 18, 124);
}

void walnut_build_screen_ui(void)
{
    if(!workspace_playlist_enabled()) {
        build_empty_workspace_screen();
        return;
    }

    memset(&workspace_ui, 0, sizeof(workspace_ui));
    lv_obj_t * scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_black(), 0);
    workspace_ui.item = 0;
    workspace_ui.repeat = 0;
    if(runtime_workspace.loaded) {
        workspace_ui.frame = clamp_int(runtime_workspace.items[0].first_frame, 0, runtime_workspace.frame_count - 1);
    }
    else {
        workspace_ui.frame = clamp_int(walnut_screen_workspace_items[0].first_frame, 0, WALNUT_SCREEN_WORKSPACE_FRAME_COUNT - 1);
    }
    workspace_ui.image = lv_image_create(scr);
    lv_obj_align(workspace_ui.image, LV_ALIGN_TOP_LEFT, 0, 0);
    workspace_apply_frame(&workspace_ui);
    lv_timer_create(workspace_timer_cb, workspace_frame_duration_ms(workspace_ui.item, workspace_ui.frame), &workspace_ui);
}

void walnut_preview_apply_dynamic_time(int advance_ms)
{
    workspace_apply_time(advance_ms);
}

#if defined(__linux__) && !defined(WALNUT_LVGL_NO_FBDEV)
int main(int argc, char ** argv)
{
    const char * fbdev = "/dev/fb0";
    const char * runtime_path = "screen/runtime/default.txt";
    for(int i = 1; i < argc; i++) {
        if(strcmp(argv[i], "--runtime") == 0 && i + 1 < argc) {
            runtime_path = argv[++i];
        }
        else if(strcmp(argv[i], "--no-runtime") == 0) {
            runtime_path = NULL;
        }
        else if(strcmp(argv[i], "--demo") != 0) {
            fbdev = argv[i];
        }
    }

    if(runtime_path != NULL) {
        walnut_screen_workspace_load_runtime(runtime_path);
    }
    if(walnut_screen_workspace_active_playlist_hash()[0] == '\0' && workspace_playlist_enabled()) {
        fprintf(stderr, "workspace playlist hash missing\n");
        return 1;
    }

    signal(SIGINT, handle_signal);
    signal(SIGTERM, handle_signal);

    lv_init();
    lv_display_t * disp = lv_linux_fbdev_create();
    if(disp == NULL) {
        fprintf(stderr, "failed to create LVGL fbdev display\n");
        return 1;
    }
    lv_linux_fbdev_set_file(disp, fbdev);
    lv_linux_fbdev_set_force_refresh(disp, true);

    walnut_build_screen_ui();

    while(running) {
        lv_tick_inc(5);
        lv_timer_handler();
        usleep(5000);
    }

    return 0;
}
#endif
