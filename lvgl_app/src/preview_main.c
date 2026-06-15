#include "lvgl.h"
#include "generated/screen_workspace_config.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PREVIEW_WIDTH 480
#define PREVIEW_HEIGHT 320
#define PREVIEW_BYTES_PER_PIXEL 2

void walnut_build_screen_ui(void);
void walnut_preview_apply_dynamic_time(int advance_ms);
bool walnut_screen_workspace_load_runtime(const char * index_path);
const char * walnut_screen_workspace_active_playlist_hash(void);

static uint16_t preview_framebuffer[PREVIEW_WIDTH * PREVIEW_HEIGHT];
static uint8_t draw_buffer[PREVIEW_WIDTH * PREVIEW_HEIGHT * PREVIEW_BYTES_PER_PIXEL];

static void write_le16(FILE * file, uint16_t value)
{
    fputc((int)(value & 0xff), file);
    fputc((int)((value >> 8) & 0xff), file);
}

static void write_le32(FILE * file, uint32_t value)
{
    fputc((int)(value & 0xff), file);
    fputc((int)((value >> 8) & 0xff), file);
    fputc((int)((value >> 16) & 0xff), file);
    fputc((int)((value >> 24) & 0xff), file);
}

static void preview_flush_cb(lv_display_t * disp, const lv_area_t * area, uint8_t * px_map)
{
    int32_t width = area->x2 - area->x1 + 1;
    int32_t height = area->y2 - area->y1 + 1;

    for(int32_t y = 0; y < height; y++) {
        int32_t dst_y = area->y1 + y;
        if(dst_y < 0 || dst_y >= PREVIEW_HEIGHT) continue;
        uint16_t * dst = &preview_framebuffer[dst_y * PREVIEW_WIDTH + area->x1];
        const uint16_t * src = (const uint16_t *)(px_map + (size_t)y * (size_t)width * PREVIEW_BYTES_PER_PIXEL);
        int32_t copy_width = width;
        if(area->x1 < 0) {
            src += -area->x1;
            copy_width += area->x1;
            dst = &preview_framebuffer[dst_y * PREVIEW_WIDTH];
        }
        if(area->x1 + copy_width > PREVIEW_WIDTH) copy_width = PREVIEW_WIDTH - area->x1;
        if(copy_width > 0) memcpy(dst, src, (size_t)copy_width * PREVIEW_BYTES_PER_PIXEL);
    }

    lv_display_flush_ready(disp);
}

static int write_bmp(const char * output_path)
{
    FILE * file = fopen(output_path, "wb");
    if(file == NULL) {
        perror("failed to open preview bmp");
        return 1;
    }

    const uint32_t row_stride = PREVIEW_WIDTH * 3;
    const uint32_t pixel_bytes = row_stride * PREVIEW_HEIGHT;
    const uint32_t header_bytes = 14 + 40;
    const uint32_t file_bytes = header_bytes + pixel_bytes;

    fwrite("BM", 1, 2, file);
    write_le32(file, file_bytes);
    write_le16(file, 0);
    write_le16(file, 0);
    write_le32(file, header_bytes);

    write_le32(file, 40);
    write_le32(file, PREVIEW_WIDTH);
    write_le32(file, PREVIEW_HEIGHT);
    write_le16(file, 1);
    write_le16(file, 24);
    write_le32(file, 0);
    write_le32(file, pixel_bytes);
    write_le32(file, 2835);
    write_le32(file, 2835);
    write_le32(file, 0);
    write_le32(file, 0);

    for(int y = PREVIEW_HEIGHT - 1; y >= 0; y--) {
        for(int x = 0; x < PREVIEW_WIDTH; x++) {
            uint16_t rgb565 = preview_framebuffer[y * PREVIEW_WIDTH + x];
            uint8_t red = (uint8_t)(((rgb565 >> 11) & 0x1f) * 255 / 31);
            uint8_t green = (uint8_t)(((rgb565 >> 5) & 0x3f) * 255 / 63);
            uint8_t blue = (uint8_t)((rgb565 & 0x1f) * 255 / 31);
            fputc(blue, file);
            fputc(green, file);
            fputc(red, file);
        }
    }

    if(fclose(file) != 0) {
        perror("failed to close preview bmp");
        return 1;
    }
    return 0;
}

int main(int argc, char ** argv)
{
    const char * output_path = "walnut-lvgl-preview.bmp";
    const char * runtime_path = NULL;
    int advance_ms = 128;
    for(int i = 1; i < argc; i++) {
        if(strcmp(argv[i], "--advance-ms") == 0 && i + 1 < argc) {
            advance_ms = atoi(argv[++i]);
            if(advance_ms < 0) advance_ms = 0;
            if(advance_ms > 30000) advance_ms = 30000;
        }
        else if(strcmp(argv[i], "--runtime") == 0 && i + 1 < argc) {
            runtime_path = argv[++i];
        }
        else {
            output_path = argv[i];
        }
    }
    if(runtime_path != NULL) {
        walnut_screen_workspace_load_runtime(runtime_path);
    }
    if(walnut_screen_workspace_active_playlist_hash()[0] == '\0' && WALNUT_SCREEN_WORKSPACE_ITEM_COUNT > 0) {
        fprintf(stderr, "workspace playlist hash missing\n");
        return 1;
    }
    memset(preview_framebuffer, 0, sizeof(preview_framebuffer));
    memset(draw_buffer, 0, sizeof(draw_buffer));

    lv_init();
    lv_display_t * disp = lv_display_create(PREVIEW_WIDTH, PREVIEW_HEIGHT);
    if(disp == NULL) {
        fprintf(stderr, "failed to create LVGL preview display\n");
        return 1;
    }
    lv_display_set_color_format(disp, LV_COLOR_FORMAT_RGB565);
    lv_display_set_flush_cb(disp, preview_flush_cb);
    lv_display_set_buffers(disp, draw_buffer, NULL, sizeof(draw_buffer), LV_DISPLAY_RENDER_MODE_FULL);

    walnut_build_screen_ui();
    walnut_preview_apply_dynamic_time(advance_ms);
    lv_refr_now(disp);

    return write_bmp(output_path);
}
