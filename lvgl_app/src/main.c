#include "lvgl.h"
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
#include <sys/stat.h>
#include <unistd.h>
#endif

static volatile bool running = true;

#define WALNUT_SCREEN_WIDTH 480
#define WALNUT_SCREEN_HEIGHT 320
#define WALNUT_SCREEN_STRIDE (WALNUT_SCREEN_WIDTH * 2)
#define WALNUT_RUNTIME_MAX_FRAMES 80
#define WALNUT_RUNTIME_MAX_ITEMS 32
#define WALNUT_RUNTIME_MAX_WIDGETS 24
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
    lv_obj_t * cell_objs[16 * 12];
    lv_obj_t * ball;
    lv_obj_t * status;
    int tick;
    int ball_x;
    int ball_y;
    int vel_x;
    int vel_y;
    int score;
    int heat;
    int still;
    bool won;
    bool has_cells;
    uint8_t light_cells[16 * 12];
    uint8_t raw_cells[16 * 12];
} lightfield_demo_t;

static lightfield_demo_t lightfield_demo;

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
    char type[16];
    char id[32];
    char text[80];
    char color[16];
    char animation[16];
    int x;
    int y;
    int w;
    int h;
    int value;
} runtime_widget_t;

typedef struct {
    bool loaded;
    bool loop;
    int frame_count;
    int item_count;
    int widget_count;
    char playlist_id[80];
    char playlist_hash[65];
    char root_dir[WALNUT_RUNTIME_PATH_MAX];
    runtime_frame_t frames[WALNUT_RUNTIME_MAX_FRAMES];
    runtime_item_t items[WALNUT_RUNTIME_MAX_ITEMS];
    runtime_widget_t widgets[WALNUT_RUNTIME_MAX_WIDGETS];
} runtime_workspace_t;

static runtime_workspace_t runtime_workspace;
static uint8_t runtime_frame_pixels[WALNUT_SCREEN_WIDTH * WALNUT_SCREEN_HEIGHT * 2];
static bool runtime_frame_valid = false;
static const char walnut_runtime_assets_schema_marker[] = "walnutpi.lvgl-runtime-assets.v1";
static const char walnut_widget_runtime_schema_marker[] = "walnutpi.lvgl-widget-runtime.v1";
static const char walnut_runtime_hot_reload_marker[] = "walnutpi.lvgl-runtime-hot-reload.v1";
static const char walnut_widget_runtime_marker[] = "walnutpi.lvgl-widget-runtime.v1";

#if defined(__linux__) && !defined(WALNUT_LVGL_NO_FBDEV)
static char runtime_watch_path[WALNUT_RUNTIME_PATH_MAX];
static time_t runtime_watch_mtime = 0;
static lv_timer_t * runtime_watch_timer = NULL;
#endif

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

static int abs_int(int value)
{
    return value < 0 ? -value : value;
}

static bool read_lightfield_pgm(uint8_t * cells, int cell_count)
{
    /* ponytail: camera stays out of LVGL; any capture tool can overwrite this tiny PGM. */
    FILE * file = fopen("/tmp/walnut-lightfield.pgm", "rb");
    if(file == NULL) return false;

    char magic[3] = {0};
    int width = 0;
    int height = 0;
    int max_value = 0;
    if(fscanf(file, "%2s %d %d %d", magic, &width, &height, &max_value) != 4
       || strcmp(magic, "P5") != 0
       || width * height != cell_count
       || max_value <= 0) {
        fclose(file);
        return false;
    }
    fgetc(file);
    size_t read_bytes = fread(cells, 1, (size_t)cell_count, file);
    fclose(file);
    return read_bytes == (size_t)cell_count;
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

static uint32_t parse_hex_color(const char * text, uint32_t fallback)
{
    if(text == NULL || text[0] == '\0') return fallback;
    if(strcmp(text, "text") == 0) return 0xf4f1df;
    if(strcmp(text, "muted") == 0) return 0x94a0a4;
    if(strcmp(text, "muted2") == 0) return 0x7f8d87;
    if(strcmp(text, "cyan") == 0) return 0x8fd6ff;
    if(strcmp(text, "green") == 0) return 0x78c58a;
    if(strcmp(text, "yellow") == 0) return 0xf0c35d;
    if(strcmp(text, "red") == 0) return 0xe06a5f;
    if(strcmp(text, "accent") == 0) return 0x78c58a;
    if(strcmp(text, "trace") == 0) return 0x2d455a;
    if(strcmp(text, "chip") == 0) return 0x203242;
    if(strcmp(text, "panelBorder") == 0) return 0x263443;
    if(strcmp(text, "barTrack") == 0) return 0x263443;
    return (uint32_t)strtoul(text, NULL, 16);
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

        char * fields[13] = {0};
        int count = 0;
        char * token = strtok(line, " \t\r");
        while(token != NULL && count < 13) {
            fields[count++] = token;
            token = strtok(NULL, " \t\r");
        }
        if(count == 0) continue;

        if(strcmp(fields[0], "schema") == 0 && count >= 2
           && strcmp(fields[1], walnut_runtime_assets_schema_marker) != 0
           && strcmp(fields[1], walnut_widget_runtime_schema_marker) != 0) {
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
        else if(strcmp(fields[0], "widget") == 0 && count >= 10) {
            if(runtime_workspace.widget_count >= WALNUT_RUNTIME_MAX_WIDGETS) continue;
            runtime_widget_t * widget = &runtime_workspace.widgets[runtime_workspace.widget_count++];
            copy_token(widget->type, sizeof(widget->type), fields[1]);
            copy_token(widget->id, sizeof(widget->id), fields[2]);
            widget->x = atoi(fields[3]);
            widget->y = atoi(fields[4]);
            widget->w = atoi(fields[5]);
            widget->h = atoi(fields[6]);
            copy_token(widget->text, sizeof(widget->text), fields[7]);
            for(char * p = widget->text; *p != '\0'; p++) {
                if(*p == '_') *p = ' ';
            }
            widget->value = atoi(fields[8]);
            copy_token(widget->color, sizeof(widget->color), fields[9]);
            if(count >= 11) copy_token(widget->animation, sizeof(widget->animation), fields[10]);
        }
    }
    fclose(file);

    runtime_workspace.loaded =
        (runtime_workspace.playlist_hash[0] != '\0'
         && runtime_workspace.frame_count > 0
         && runtime_workspace.item_count > 0)
        || runtime_workspace.widget_count > 0;
    return runtime_workspace.loaded;
}

bool walnut_screen_workspace_load_runtime(const char * index_path)
{
    if(index_path == NULL || index_path[0] == '\0') return false;
    bool loaded = parse_runtime_workspace(index_path);
#if defined(__linux__) && !defined(WALNUT_LVGL_NO_FBDEV)
    struct stat st;
    if(loaded && stat(index_path, &st) == 0) runtime_watch_mtime = st.st_mtime;
#endif
    return loaded;
}

const char * walnut_screen_workspace_active_playlist_hash(void)
{
    if(runtime_workspace.loaded) return runtime_workspace.playlist_hash;
    return "";
}

static bool workspace_playlist_enabled(void)
{
    return runtime_workspace.loaded && runtime_workspace.item_count > 0 && runtime_workspace.frame_count > 0;
}

static int workspace_frame_duration_ms(int item_index, int frame_index)
{
    if(item_index < 0 || item_index >= runtime_workspace.item_count) return 1000;
    const runtime_item_t * item = &runtime_workspace.items[item_index];
    if(item->frame_count <= 1) return clamp_int(item->duration_ms, 1, 86400000);
    if(frame_index < 0 || frame_index >= runtime_workspace.frame_count) return 1000;
    return clamp_int(runtime_workspace.frames[frame_index].duration_ms, 1, 600000);
}

static void workspace_apply_frame(workspace_ui_t * ui)
{
    if(ui == NULL || ui->image == NULL || !workspace_playlist_enabled()) return;
    ui->item = clamp_int(ui->item, 0, runtime_workspace.item_count - 1);
    const runtime_item_t * item = &runtime_workspace.items[ui->item];
    int first_frame = clamp_int(item->first_frame, 0, runtime_workspace.frame_count - 1);
    int frame_count = clamp_int(item->frame_count, 1, runtime_workspace.frame_count - first_frame);
    ui->frame = clamp_int(ui->frame, first_frame, first_frame + frame_count - 1);
    runtime_frame_t * frame = &runtime_workspace.frames[ui->frame];
    if(read_runtime_frame_pixels(frame)) lv_image_set_src(ui->image, &frame->image);
}

static void workspace_advance(workspace_ui_t * ui)
{
    if(ui == NULL || ui->stopped || !workspace_playlist_enabled()) return;
    int item_count = runtime_workspace.item_count;
    int frame_total = runtime_workspace.frame_count;
    int first_frame = 0;
    int frame_count = 1;
    int repeat = 1;
    const runtime_item_t * item = &runtime_workspace.items[ui->item];
    first_frame = clamp_int(item->first_frame, 0, frame_total - 1);
    frame_count = clamp_int(item->frame_count, 1, frame_total - first_frame);
    repeat = clamp_int(item->repeat, 1, 1000);
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
    else if(runtime_workspace.loop) {
        ui->item = 0;
    }
    else {
        ui->stopped = true;
        ui->frame = first_frame + frame_count - 1;
        return;
    }
    const runtime_item_t * next_item = &runtime_workspace.items[ui->item];
    ui->frame = clamp_int(next_item->first_frame, 0, frame_total - 1);
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

static void workspace_restart_from_first_frame(void)
{
    if(workspace_ui.image == NULL || !workspace_playlist_enabled()) return;
    workspace_ui.item = 0;
    workspace_ui.repeat = 0;
    workspace_ui.stopped = false;
    workspace_ui.frame = clamp_int(runtime_workspace.items[0].first_frame, 0, runtime_workspace.frame_count - 1);
    workspace_apply_frame(&workspace_ui);
}

#if defined(__linux__) && !defined(WALNUT_LVGL_NO_FBDEV)
static void runtime_watch_timer_cb(lv_timer_t * timer)
{
    (void)timer;
    if(runtime_watch_path[0] == '\0') return;
    struct stat st;
    if(stat(runtime_watch_path, &st) != 0) return;
    if(runtime_watch_mtime != 0 && st.st_mtime == runtime_watch_mtime) return;
    if(walnut_screen_workspace_load_runtime(runtime_watch_path)) {
        runtime_watch_mtime = st.st_mtime;
        workspace_restart_from_first_frame();
    }
}
#endif

static void workspace_apply_time(int advance_ms)
{
    if(!workspace_playlist_enabled()) return;
    if(advance_ms < 0) advance_ms = 0;

    int total = 0;
    int item_count = runtime_workspace.item_count;
    int frame_total = runtime_workspace.frame_count;
    bool loop = runtime_workspace.loop;

    for(int item_index = 0; item_index < item_count; item_index++) {
        int first_frame = 0;
        int frame_count = 1;
        int duration_ms = 1000;
        int repeat = 1;
        const runtime_item_t * item = &runtime_workspace.items[item_index];
        first_frame = clamp_int(item->first_frame, 0, frame_total - 1);
        frame_count = clamp_int(item->frame_count, 1, frame_total - first_frame);
        duration_ms = item->duration_ms;
        repeat = item->repeat;
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
        const runtime_item_t * item = &runtime_workspace.items[item_index];
        first_frame = clamp_int(item->first_frame, 0, frame_total - 1);
        frame_count = clamp_int(item->frame_count, 1, frame_total - first_frame);
        duration_ms = item->duration_ms;
        repeat = item->repeat;
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
    lv_label_set_text(reason, "Runtime screen playlist not loaded.");
    lv_obj_set_style_text_color(reason, lv_color_hex(0x95a1a6), 0);
    lv_obj_set_style_text_font(reason, &lv_font_montserrat_14, 0);
    lv_obj_set_width(reason, 440);
    lv_label_set_long_mode(reason, LV_LABEL_LONG_WRAP);
    lv_obj_align(reason, LV_ALIGN_TOP_LEFT, 18, 124);
}

static void lightfield_demo_timer_cb(lv_timer_t * timer)
{
    lightfield_demo_t * demo = (lightfield_demo_t *)lv_timer_get_user_data(timer);
    if(read_lightfield_pgm(demo->raw_cells, 16 * 12)) {
        int low = 255;
        int high = 0;
        for(int index = 0; index < 16 * 12; index++) {
            if(demo->raw_cells[index] < low) low = demo->raw_cells[index];
            if(demo->raw_cells[index] > high) high = demo->raw_cells[index];
        }
        if(!demo->has_cells) {
            for(int index = 0; index < 16 * 12; index++) {
                demo->light_cells[index] = (uint8_t)(high - low < 32 ? 120 : ((int)(demo->raw_cells[index] - low) * 255 / (high - low)));
            }
            demo->has_cells = true;
        }
        else {
            for(int index = 0; index < 16 * 12; index++) {
                int normalized = high - low < 32 ? 120 : ((int)(demo->raw_cells[index] - low) * 255 / (high - low));
                demo->light_cells[index] = (uint8_t)(((int)demo->light_cells[index] * 7 + normalized) / 8);
            }
        }
    }

    for(int y = 0; y < 12; y++) {
        for(int x = 0; x < 16; x++) {
            int index = y * 16 + x;
            int value = demo->has_cells ? demo->light_cells[index] : 120;
            uint32_t color = value > 210 ? 0xf0c35d : value > 45 ? 0x355262 : 0x101820;
            lv_obj_set_style_bg_color(demo->cell_objs[index], lv_color_hex(color), 0);
        }
    }

    int force_x = 0;
    int force_y = 0;
    int best_light = 0;
    int near_light = 0;
    if(demo->has_cells) {
        for(int y = 0; y < 12; y++) {
            for(int x = 0; x < 16; x++) {
                int value = demo->light_cells[y * 16 + x] - 180;
                if(value <= 0) continue;
                int center_x = x * 30 + 15;
                int center_y = 42 + y * 20 + 10;
                int dx = center_x - demo->ball_x;
                int dy = center_y - demo->ball_y;
                int distance = abs_int(dx) + abs_int(dy) + 24;
                int weight = value * 44 / distance;
                force_x += dx * weight / 64;
                force_y += dy * weight / 64;
                if(value > best_light) best_light = value;
                if(distance < 86 && value > near_light) near_light = value;
            }
        }
    }

    demo->vel_x = demo->vel_x * 86 / 100 + clamp_int(force_x, -44, 44);
    demo->vel_y = demo->vel_y * 86 / 100 + clamp_int(force_y, -44, 44);
    demo->vel_x = clamp_int(demo->vel_x, -176, 176);
    demo->vel_y = clamp_int(demo->vel_y, -176, 176);
    demo->ball_x += demo->vel_x / 16;
    demo->ball_y += demo->vel_y / 16;
    demo->ball_x = clamp_int(demo->ball_x, 8, 452);
    demo->ball_y = clamp_int(demo->ball_y, 46, 286);

    int speed = abs_int(demo->vel_x) + abs_int(demo->vel_y);
    demo->score += near_light > 0 ? 2 : 1;
    demo->still = speed < 18 ? demo->still + 1 : 0;
    demo->heat += near_light / 28 + (best_light > 60 ? 1 : 0) + (demo->still > 18 ? 2 : 0);
    demo->heat -= speed > 80 ? 2 : 1;
    if(demo->heat >= 100) {
        demo->heat = 0;
        demo->still = 0;
        demo->score = 0;
        demo->ball_x = 34;
        demo->ball_y = 74;
        demo->vel_x = 0;
        demo->vel_y = 0;
#if defined(__linux__) && !defined(WALNUT_LVGL_NO_FBDEV)
        system("printf '\\a' >/dev/tty0 2>/dev/null || true");
#endif
    }
    demo->heat = clamp_int(demo->heat, 0, 100);
    char status[80];
    snprintf(status, sizeof(status), "KEEP IT DANCING  SCORE %04d  HEAT %03d", demo->score, demo->heat);
    lv_label_set_text(demo->status, status);
    lv_obj_set_pos(demo->ball, demo->ball_x - 10, demo->ball_y - 10);
    demo->tick++;
}

void walnut_build_lightfield_demo(void)
{
    memset(&lightfield_demo, 0, sizeof(lightfield_demo));
    lightfield_demo.ball_x = 34;
    lightfield_demo.ball_y = 74;

    lv_obj_t * scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_hex(0x05080b), 0);

    lv_obj_t * title = lv_label_create(scr);
    lv_label_set_text(title, "LIGHTFIELD");
    lv_obj_set_style_text_color(title, lv_color_hex(0xf4f1df), 0);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_24, 0);
    lv_obj_align(title, LV_ALIGN_TOP_LEFT, 12, 10);

    lightfield_demo.status = lv_label_create(scr);
    lv_label_set_text(lightfield_demo.status, "KEEP IT DANCING  SCORE 0000  HEAT 000");
    lv_obj_set_style_text_color(lightfield_demo.status, lv_color_hex(0x94a0a4), 0);
    lv_obj_set_style_text_font(lightfield_demo.status, &lv_font_montserrat_14, 0);
    lv_obj_align(lightfield_demo.status, LV_ALIGN_TOP_LEFT, 178, 17);

    for(int y = 0; y < 12; y++) {
        for(int x = 0; x < 16; x++) {
            lv_obj_t * cell = lv_obj_create(scr);
            lv_obj_remove_style_all(cell);
            lv_obj_set_style_bg_opa(cell, LV_OPA_COVER, 0);
            lv_obj_set_style_bg_color(cell, lv_color_hex(0x101820), 0);
            lv_obj_set_style_border_width(cell, 1, 0);
            lv_obj_set_style_border_color(cell, lv_color_hex(0x263443), 0);
            lv_obj_set_size(cell, 29, 19);
            lv_obj_set_pos(cell, x * 30, 42 + y * 20);
            lightfield_demo.cell_objs[y * 16 + x] = cell;
        }
    }

    lightfield_demo.ball = lv_obj_create(scr);
    lv_obj_remove_style_all(lightfield_demo.ball);
    lv_obj_set_style_radius(lightfield_demo.ball, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_opa(lightfield_demo.ball, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(lightfield_demo.ball, lv_color_hex(0x8fd6ff), 0);
    lv_obj_set_size(lightfield_demo.ball, 20, 20);
    lv_obj_set_pos(lightfield_demo.ball, lightfield_demo.ball_x - 10, lightfield_demo.ball_y - 10);

    lv_timer_create(lightfield_demo_timer_cb, 80, &lightfield_demo);
}

static void anim_bar_value_cb(void * obj, int32_t value)
{
    lv_bar_set_value((lv_obj_t *)obj, value, LV_ANIM_OFF);
}

static void anim_opa_cb(void * obj, int32_t value)
{
    lv_obj_set_style_opa((lv_obj_t *)obj, (lv_opa_t)value, 0);
}

static void apply_widget_animation(lv_obj_t * obj, runtime_widget_t * widget)
{
    if(obj == NULL || widget == NULL || strcmp(widget->animation, "pulse") != 0) return;
    lv_anim_t anim;
    lv_anim_init(&anim);
    lv_anim_set_var(&anim, obj);
    lv_anim_set_values(&anim, LV_OPA_60, LV_OPA_COVER);
    lv_anim_set_duration(&anim, 900);
    lv_anim_set_playback_duration(&anim, 900);
    lv_anim_set_repeat_count(&anim, LV_ANIM_REPEAT_INFINITE);
    lv_anim_set_exec_cb(&anim, anim_opa_cb);
    lv_anim_start(&anim);
}

static void build_runtime_widgets(lv_obj_t * scr)
{
    for(int index = 0; index < runtime_workspace.widget_count; index++) {
        runtime_widget_t * widget = &runtime_workspace.widgets[index];
        if(strcmp(widget->type, "label") == 0) {
            lv_obj_t * label = lv_label_create(scr);
            lv_label_set_text(label, widget->text);
            lv_obj_set_style_text_color(label, lv_color_hex(parse_hex_color(widget->color, 0xf4f1df)), 0);
            lv_obj_set_style_text_font(label, widget->h >= 48 ? &lv_font_montserrat_24 : &lv_font_montserrat_14, 0);
            lv_obj_set_width(label, clamp_int(widget->w, 20, WALNUT_SCREEN_WIDTH));
            lv_obj_set_style_text_align(label, LV_TEXT_ALIGN_CENTER, 0);
            lv_label_set_long_mode(label, LV_LABEL_LONG_CLIP);
            lv_obj_align(label, LV_ALIGN_TOP_LEFT, clamp_int(widget->x, 0, WALNUT_SCREEN_WIDTH - 1), clamp_int(widget->y, 0, WALNUT_SCREEN_HEIGHT - 1));
            apply_widget_animation(label, widget);
        }
        else if(strcmp(widget->type, "rect") == 0) {
            lv_obj_t * rect_obj = lv_obj_create(scr);
            lv_obj_remove_style_all(rect_obj);
            lv_obj_set_style_bg_opa(rect_obj, LV_OPA_COVER, 0);
            lv_obj_set_style_bg_color(rect_obj, lv_color_hex(parse_hex_color(widget->color, 0x78c58a)), 0);
            lv_obj_set_size(rect_obj, clamp_int(widget->w, 1, WALNUT_SCREEN_WIDTH), clamp_int(widget->h, 1, WALNUT_SCREEN_HEIGHT));
            lv_obj_align(rect_obj, LV_ALIGN_TOP_LEFT, clamp_int(widget->x, 0, WALNUT_SCREEN_WIDTH - 1), clamp_int(widget->y, 0, WALNUT_SCREEN_HEIGHT - 1));
            apply_widget_animation(rect_obj, widget);
        }
        else if(strcmp(widget->type, "bar") == 0) {
            lv_obj_t * bar = lv_bar_create(scr);
            lv_obj_remove_style_all(bar);
            lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, 0);
            lv_obj_set_style_bg_color(bar, lv_color_hex(0x263443), 0);
            lv_obj_set_style_bg_color(bar, lv_color_hex(parse_hex_color(widget->color, 0x78c58a)), LV_PART_INDICATOR);
            lv_obj_set_size(bar, clamp_int(widget->w, 20, WALNUT_SCREEN_WIDTH), clamp_int(widget->h, 6, 40));
            lv_obj_align(bar, LV_ALIGN_TOP_LEFT, clamp_int(widget->x, 0, WALNUT_SCREEN_WIDTH - 1), clamp_int(widget->y, 0, WALNUT_SCREEN_HEIGHT - 1));
            lv_bar_set_range(bar, 0, 100);
            lv_bar_set_value(bar, clamp_int(widget->value, 0, 100), LV_ANIM_OFF);
            lv_anim_t anim;
            lv_anim_init(&anim);
            lv_anim_set_var(&anim, bar);
            lv_anim_set_values(&anim, clamp_int(widget->value - 8, 0, 100), clamp_int(widget->value + 8, 0, 100));
            lv_anim_set_duration(&anim, 900);
            lv_anim_set_playback_duration(&anim, 900);
            lv_anim_set_repeat_count(&anim, LV_ANIM_REPEAT_INFINITE);
            lv_anim_set_exec_cb(&anim, anim_bar_value_cb);
            lv_anim_start(&anim);
            apply_widget_animation(bar, widget);
        }
        else if(strcmp(widget->type, "arc") == 0) {
            lv_obj_t * arc = lv_arc_create(scr);
            lv_obj_remove_style(arc, NULL, LV_PART_KNOB);
            lv_obj_set_style_arc_color(arc, lv_color_hex(0x263443), LV_PART_MAIN);
            lv_obj_set_style_arc_color(arc, lv_color_hex(parse_hex_color(widget->color, 0x8fd6ff)), LV_PART_INDICATOR);
            lv_obj_set_style_arc_width(arc, 10, LV_PART_MAIN);
            lv_obj_set_style_arc_width(arc, 10, LV_PART_INDICATOR);
            lv_obj_set_size(arc, clamp_int(widget->w, 30, WALNUT_SCREEN_WIDTH), clamp_int(widget->h, 30, WALNUT_SCREEN_HEIGHT));
            lv_obj_align(arc, LV_ALIGN_TOP_LEFT, clamp_int(widget->x, 0, WALNUT_SCREEN_WIDTH - 1), clamp_int(widget->y, 0, WALNUT_SCREEN_HEIGHT - 1));
            lv_arc_set_range(arc, 0, 100);
            lv_arc_set_value(arc, clamp_int(widget->value, 0, 100));
            apply_widget_animation(arc, widget);
        }
    }
}

void walnut_build_screen_ui(void)
{
    if(!workspace_playlist_enabled() && runtime_workspace.widget_count <= 0) {
        build_empty_workspace_screen();
        return;
    }

    memset(&workspace_ui, 0, sizeof(workspace_ui));
    lv_obj_t * scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_black(), 0);
    if(!workspace_playlist_enabled()) {
        build_runtime_widgets(scr);
        return;
    }
    workspace_ui.item = 0;
    workspace_ui.repeat = 0;
    workspace_ui.frame = clamp_int(runtime_workspace.items[0].first_frame, 0, runtime_workspace.frame_count - 1);
    workspace_ui.image = lv_image_create(scr);
    lv_obj_align(workspace_ui.image, LV_ALIGN_TOP_LEFT, 0, 0);
    workspace_apply_frame(&workspace_ui);
    build_runtime_widgets(scr);
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
    const char * demo_name = NULL;
    for(int i = 1; i < argc; i++) {
        if(strcmp(argv[i], "--runtime") == 0 && i + 1 < argc) {
            runtime_path = argv[++i];
        }
        else if(strcmp(argv[i], "--no-runtime") == 0) {
            runtime_path = NULL;
        }
        else if(strcmp(argv[i], "--demo") == 0 && i + 1 < argc && strcmp(argv[i + 1], "lightfield") == 0) {
            demo_name = argv[++i];
            runtime_path = NULL;
        }
        else if(strcmp(argv[i], "--demo") == 0) {
            continue;
        }
        else {
            fbdev = argv[i];
        }
    }

    if(runtime_path != NULL) {
        copy_token(runtime_watch_path, sizeof(runtime_watch_path), runtime_path);
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

    if(demo_name != NULL && strcmp(demo_name, "lightfield") == 0) {
        walnut_build_lightfield_demo();
    }
    else if(demo_name != NULL) {
        fprintf(stderr, "unknown LVGL demo: %s\n", demo_name);
        return 1;
    }
    else {
        walnut_build_screen_ui();
    }
    (void)walnut_runtime_hot_reload_marker;
    (void)walnut_widget_runtime_marker;
    if(runtime_watch_path[0] != '\0') {
        runtime_watch_timer = lv_timer_create(runtime_watch_timer_cb, 1000, NULL);
        (void)runtime_watch_timer;
    }

    while(running) {
        lv_tick_inc(5);
        lv_timer_handler();
        usleep(5000);
    }

    return 0;
}
#endif
