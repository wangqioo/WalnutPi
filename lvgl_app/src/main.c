#include "lvgl.h"
#include "generated/screen_workspace_config.h"
#ifndef WALNUT_LVGL_NO_FBDEV
#include "src/drivers/display/fb/lv_linux_fbdev.h"
#endif

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(__linux__) && !defined(WALNUT_LVGL_NO_FBDEV)
#include <signal.h>
#include <unistd.h>
#endif

static volatile bool running = true;

typedef struct {
    lv_obj_t * image;
    int item;
    int repeat;
    int frame;
    bool stopped;
} workspace_ui_t;

static workspace_ui_t workspace_ui;

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

static bool workspace_playlist_enabled(void)
{
    return WALNUT_SCREEN_WORKSPACE_ITEM_COUNT > 0 && WALNUT_SCREEN_WORKSPACE_FRAME_COUNT > 0;
}

static int workspace_frame_duration_ms(int item_index, int frame_index)
{
    if(item_index < 0 || item_index >= WALNUT_SCREEN_WORKSPACE_ITEM_COUNT) return 1000;
    const walnut_screen_workspace_item_config_t * item = &walnut_screen_workspace_items[item_index];
    if(item->frame_count <= 1) return clamp_int(item->duration_ms, 1, 86400000);
    if(frame_index < 0 || frame_index >= WALNUT_SCREEN_WORKSPACE_FRAME_COUNT) return 1000;
    return clamp_int(walnut_screen_workspace_frames[frame_index].duration_ms, 1, 600000);
}

static void workspace_apply_frame(workspace_ui_t * ui)
{
    if(ui == NULL || ui->image == NULL || !workspace_playlist_enabled()) return;
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
    const walnut_screen_workspace_item_config_t * item = &walnut_screen_workspace_items[ui->item];
    int first_frame = clamp_int(item->first_frame, 0, WALNUT_SCREEN_WORKSPACE_FRAME_COUNT - 1);
    int frame_count = clamp_int(item->frame_count, 1, WALNUT_SCREEN_WORKSPACE_FRAME_COUNT - first_frame);
    if(frame_count > 1 && ui->frame < first_frame + frame_count - 1) {
        ui->frame++;
        return;
    }

    ui->frame = first_frame;
    ui->repeat++;
    if(ui->repeat < clamp_int(item->repeat, 1, 1000)) return;

    ui->repeat = 0;
    if(ui->item < WALNUT_SCREEN_WORKSPACE_ITEM_COUNT - 1) {
        ui->item++;
    }
    else if(WALNUT_SCREEN_WORKSPACE_PLAYLIST_LOOP) {
        ui->item = 0;
    }
    else {
        ui->stopped = true;
        ui->frame = first_frame + frame_count - 1;
        return;
    }
    const walnut_screen_workspace_item_config_t * next_item = &walnut_screen_workspace_items[ui->item];
    ui->frame = clamp_int(next_item->first_frame, 0, WALNUT_SCREEN_WORKSPACE_FRAME_COUNT - 1);
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
    for(int item_index = 0; item_index < WALNUT_SCREEN_WORKSPACE_ITEM_COUNT; item_index++) {
        const walnut_screen_workspace_item_config_t * item = &walnut_screen_workspace_items[item_index];
        int first_frame = clamp_int(item->first_frame, 0, WALNUT_SCREEN_WORKSPACE_FRAME_COUNT - 1);
        int frame_count = clamp_int(item->frame_count, 1, WALNUT_SCREEN_WORKSPACE_FRAME_COUNT - first_frame);
        int cycle = 0;
        if(frame_count <= 1) {
            cycle = clamp_int(item->duration_ms, 1, 86400000);
        }
        else {
            for(int offset = 0; offset < frame_count; offset++) {
                cycle += clamp_int(walnut_screen_workspace_frames[first_frame + offset].duration_ms, 1, 600000);
            }
        }
        total += cycle * clamp_int(item->repeat, 1, 1000);
    }
    if(total <= 0) total = 1;

    int cursor = WALNUT_SCREEN_WORKSPACE_PLAYLIST_LOOP ? advance_ms % total : clamp_int(advance_ms, 0, total - 1);
    for(int item_index = 0; item_index < WALNUT_SCREEN_WORKSPACE_ITEM_COUNT; item_index++) {
        const walnut_screen_workspace_item_config_t * item = &walnut_screen_workspace_items[item_index];
        int first_frame = clamp_int(item->first_frame, 0, WALNUT_SCREEN_WORKSPACE_FRAME_COUNT - 1);
        int frame_count = clamp_int(item->frame_count, 1, WALNUT_SCREEN_WORKSPACE_FRAME_COUNT - first_frame);
        int cycle = 0;
        if(frame_count <= 1) {
            cycle = clamp_int(item->duration_ms, 1, 86400000);
        }
        else {
            for(int offset = 0; offset < frame_count; offset++) {
                cycle += clamp_int(walnut_screen_workspace_frames[first_frame + offset].duration_ms, 1, 600000);
            }
        }

        int item_total = cycle * clamp_int(item->repeat, 1, 1000);
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
                int duration = clamp_int(walnut_screen_workspace_frames[first_frame + offset].duration_ms, 1, 600000);
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
    workspace_ui.frame = clamp_int(walnut_screen_workspace_items[0].first_frame, 0, WALNUT_SCREEN_WORKSPACE_FRAME_COUNT - 1);
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
    if(walnut_screen_workspace_config_playlist_hash()[0] == '\0' && workspace_playlist_enabled()) {
        fprintf(stderr, "workspace playlist hash missing\n");
        return 1;
    }

    const char * fbdev = "/dev/fb0";
    for(int i = 1; i < argc; i++) {
        if(strcmp(argv[i], "--demo") != 0) fbdev = argv[i];
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
