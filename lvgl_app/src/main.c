#include "lvgl.h"
#include "generated/screen_config.h"
#include "src/drivers/display/fb/lv_linux_fbdev.h"

#include <fcntl.h>
#include <linux/input.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static volatile bool running = true;

#define C_BG 0x05080b
#define C_PANEL 0x11191d
#define C_PANEL_2 0x172329
#define C_LINE 0x33434a
#define C_TEXT 0xf4f1df
#define C_MUTED 0x95a1a6
#define C_CYAN 0x67d6ff
#define C_PAPER 0xf7e9b9
#define C_INK 0x111111
#define C_WHITE 0xffffff

#define WALNUT_FONT_TITLE (&lv_font_montserrat_24)
#define WALNUT_FONT_BODY (&lv_font_montserrat_18)
#define WALNUT_FONT_SMALL (&lv_font_montserrat_14)

#ifndef WALNUT_SCREEN_PAGE_COUNT
#define WALNUT_SCREEN_PAGE_COUNT 1
#endif

#ifndef WALNUT_SCREEN_COMPONENT_COUNT
#define WALNUT_SCREEN_COMPONENT_COUNT 1
#endif

#if defined(__GNUC__)
static const char walnut_screen_manifest_hash[] __attribute__((used)) = WALNUT_SCREEN_MANIFEST_HASH;
#else
static const char walnut_screen_manifest_hash[] = WALNUT_SCREEN_MANIFEST_HASH;
#endif

typedef struct {
    lv_obj_t * pages[WALNUT_SCREEN_PAGE_COUNT];
    lv_obj_t * tabs[WALNUT_SCREEN_PAGE_COUNT];
    int input_fd;
    bool auto_rotate;
    int page;
} screen_ui_t;

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

static bool text_equals(const char * a, const char * b)
{
    return a != NULL && b != NULL && strcmp(a, b) == 0;
}

static bool text_is_empty(const char * value)
{
    return value == NULL || value[0] == '\0';
}

static void style_panel(lv_obj_t * obj, lv_color_t border)
{
    lv_obj_set_style_radius(obj, 6, 0);
    lv_obj_set_style_bg_color(obj, lv_color_hex(C_PANEL), 0);
    lv_obj_set_style_border_color(obj, border, 0);
    lv_obj_set_style_border_width(obj, 1, 0);
    lv_obj_set_style_pad_all(obj, 8, 0);
}

static lv_obj_t * add_wrapped_label(lv_obj_t * parent,
                                    const char * text,
                                    lv_color_t color,
                                    const lv_font_t * font,
                                    int width)
{
    lv_obj_t * label = lv_label_create(parent);
    lv_label_set_text(label, text == NULL ? "" : text);
    lv_label_set_long_mode(label, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(label, width);
    lv_obj_set_style_text_color(label, color, 0);
    lv_obj_set_style_text_font(label, font, 0);
    return label;
}

static lv_obj_t * create_page(lv_obj_t * parent)
{
    lv_obj_t * page = lv_obj_create(parent);
    lv_obj_set_size(page, 448, 246);
    lv_obj_align(page, LV_ALIGN_TOP_LEFT, 16, WALNUT_SCREEN_PAGE_COUNT > 1 ? 62 : 58);
    lv_obj_set_style_bg_opa(page, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(page, 0, 0);
    lv_obj_set_style_pad_all(page, 8, 0);
    lv_obj_set_style_pad_row(page, 7, 0);
    lv_obj_set_flex_flow(page, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(page, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_START);
    return page;
}

static bool page_has_generated_component(int page_index)
{
    for(int i = 0; i < WALNUT_SCREEN_COMPONENT_COUNT; i++) {
        if(walnut_screen_components[i].page_index == page_index
           && text_equals(walnut_screen_components[i].type, "generatedPage")) {
            return true;
        }
    }
    return false;
}

static void prepare_generated_page(lv_obj_t * page, bool full_screen)
{
    lv_obj_set_size(page, 448, full_screen ? 296 : 254);
    lv_obj_align(page, LV_ALIGN_TOP_LEFT, 16, full_screen ? 12 : 54);
    lv_obj_set_style_pad_all(page, 0, 0);
    lv_obj_set_style_bg_opa(page, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(page, lv_color_hex(C_BG), 0);
    lv_obj_set_layout(page, LV_LAYOUT_NONE);
}

static lv_obj_t * add_card(lv_obj_t * parent, int height, lv_color_t color)
{
    lv_obj_t * card = lv_obj_create(parent);
    lv_obj_set_size(card, 432, height);
    style_panel(card, color);
    return card;
}

static void add_text_component(lv_obj_t * parent,
                               const walnut_screen_component_config_t * component,
                               int height,
                               const lv_font_t * body_font)
{
    lv_color_t color = lv_color_hex(component->tone_color);
    lv_obj_t * card = add_card(parent, height, color);

    lv_obj_t * title = add_wrapped_label(card, component->title, lv_color_hex(C_MUTED), WALNUT_FONT_SMALL, 404);
    lv_obj_align(title, LV_ALIGN_TOP_LEFT, 0, 0);

    lv_obj_t * body = add_wrapped_label(card, component->text, lv_color_hex(C_TEXT), body_font, 404);
    lv_obj_align(body, LV_ALIGN_TOP_LEFT, 0, 24);
}

static void add_progress_component(lv_obj_t * parent, const walnut_screen_component_config_t * component)
{
    lv_color_t color = lv_color_hex(component->tone_color);
    lv_obj_t * card = add_card(parent, 58, color);

    lv_obj_t * title = add_wrapped_label(card, component->title, lv_color_hex(C_TEXT), WALNUT_FONT_SMALL, 150);
    lv_obj_align(title, LV_ALIGN_LEFT_MID, 0, 0);

    lv_obj_t * bar = lv_bar_create(card);
    lv_obj_set_size(bar, 238, 16);
    lv_obj_align(bar, LV_ALIGN_RIGHT_MID, 0, 0);
    lv_bar_set_range(bar, 0, 100);
    lv_bar_set_value(bar, clamp_int(component->progress, 0, 100), LV_ANIM_OFF);
    lv_obj_set_style_bg_color(bar, lv_color_hex(C_PANEL_2), LV_PART_MAIN);
    lv_obj_set_style_bg_color(bar, color, LV_PART_INDICATOR);

    char value[16];
    snprintf(value, sizeof(value), "%d%%", clamp_int(component->progress, 0, 100));
    lv_obj_t * pct = add_wrapped_label(card, value, color, WALNUT_FONT_SMALL, 42);
    lv_obj_align_to(pct, bar, LV_ALIGN_OUT_RIGHT_MID, 8, 0);
}

static void set_box_style(lv_obj_t * obj, lv_color_t bg, lv_color_t border, int border_width, int radius)
{
    lv_obj_set_style_radius(obj, radius, 0);
    lv_obj_set_style_bg_color(obj, bg, 0);
    lv_obj_set_style_border_color(obj, border, 0);
    lv_obj_set_style_border_width(obj, border_width, 0);
    lv_obj_set_style_pad_all(obj, 0, 0);
}

static void add_generated_items(lv_obj_t * parent,
                                const char * items,
                                lv_color_t fg,
                                lv_color_t bg,
                                lv_color_t border)
{
    if(text_is_empty(items)) return;

    char copy[192];
    snprintf(copy, sizeof(copy), "%s", items);
    char * line = strtok(copy, "\n");
    int index = 0;
    while(line != NULL && index < 3) {
        lv_obj_t * box = lv_obj_create(parent);
        lv_obj_set_size(box, 132, 42);
        set_box_style(box, bg, border, 2, 6);
        lv_obj_align(box, LV_ALIGN_BOTTOM_LEFT, index * 142, 0);
        lv_obj_set_style_pad_left(box, 8, 0);
        lv_obj_set_style_pad_right(box, 8, 0);
        lv_obj_set_style_pad_top(box, 5, 0);

        lv_obj_t * label = add_wrapped_label(box, line, fg, WALNUT_FONT_SMALL, 112);
        lv_label_set_long_mode(label, LV_LABEL_LONG_DOT);
        lv_obj_align(label, LV_ALIGN_LEFT_MID, 0, 0);

        line = strtok(NULL, "\n");
        index++;
    }
}

static void add_generated_page_component(lv_obj_t * parent, const walnut_screen_component_config_t * component)
{
    bool comic = text_equals(component->style, "comic");
    bool minimal = text_equals(component->style, "minimal");
    bool full_screen = lv_obj_get_height(parent) > 270;
    lv_color_t accent = lv_color_hex(component->tone_color);
    lv_color_t bg = comic ? lv_color_hex(C_PAPER) : minimal ? lv_color_hex(0xf1efe4) : lv_color_hex(C_BG);
    lv_color_t fg = (comic || minimal) ? lv_color_hex(C_INK) : lv_color_hex(C_TEXT);
    lv_color_t panel_bg = comic ? lv_color_hex(0xfff6cf) : minimal ? lv_color_hex(C_WHITE) : lv_color_hex(C_PANEL);
    lv_color_t soft_bg = comic ? lv_color_hex(C_WHITE) : minimal ? lv_color_hex(0xf8f7ef) : lv_color_hex(C_PANEL_2);
    lv_color_t border = comic ? lv_color_hex(C_INK) : accent;

    lv_obj_set_style_bg_color(parent, bg, 0);
    lv_obj_set_layout(parent, LV_LAYOUT_NONE);
    lv_obj_set_style_pad_all(parent, 0, 0);

    lv_obj_t * badge = lv_obj_create(parent);
    lv_obj_set_size(badge, 78, 28);
    set_box_style(badge, accent, comic ? lv_color_hex(C_INK) : accent, comic ? 3 : 1, 5);
    lv_obj_align(badge, LV_ALIGN_TOP_RIGHT, -4, full_screen ? 4 : 0);

    lv_obj_t * badge_text = add_wrapped_label(badge, component->badge, comic ? lv_color_hex(C_INK) : lv_color_hex(C_BG), WALNUT_FONT_SMALL, 62);
    lv_label_set_long_mode(badge_text, LV_LABEL_LONG_DOT);
    lv_obj_center(badge_text);

    lv_obj_t * kicker = add_wrapped_label(parent, component->kicker, accent, WALNUT_FONT_SMALL, 250);
    lv_label_set_long_mode(kicker, LV_LABEL_LONG_DOT);
    lv_obj_align(kicker, LV_ALIGN_TOP_LEFT, 4, full_screen ? 10 : 6);

    if(comic) {
        lv_obj_t * shadow = lv_obj_create(parent);
        lv_obj_set_size(shadow, 394, full_screen ? 172 : 154);
        set_box_style(shadow, lv_color_hex(C_INK), lv_color_hex(C_INK), 0, 5);
        lv_obj_align(shadow, LV_ALIGN_TOP_LEFT, 26, full_screen ? 58 : 48);
    }

    lv_obj_t * panel = lv_obj_create(parent);
    lv_obj_set_size(panel, comic ? 394 : 410, full_screen ? 172 : comic ? 154 : 150);
    set_box_style(panel, panel_bg, border, comic ? 4 : 2, comic ? 5 : 8);
    lv_obj_align(panel, LV_ALIGN_TOP_LEFT, comic ? 18 : 8, full_screen ? 50 : 40);
    lv_obj_set_style_pad_all(panel, 14, 0);

    lv_obj_t * title = add_wrapped_label(panel, component->title, fg, WALNUT_FONT_TITLE, comic ? 328 : 360);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_28, 0);
    lv_obj_align(title, LV_ALIGN_TOP_LEFT, 0, 0);

    lv_obj_t * body_box = lv_obj_create(panel);
    lv_obj_set_size(body_box, comic ? 322 : 360, 50);
    set_box_style(body_box, soft_bg, comic ? lv_color_hex(C_INK) : border, comic ? 3 : 1, comic ? 20 : 6);
    lv_obj_align(body_box, LV_ALIGN_BOTTOM_LEFT, 0, 0);
    lv_obj_set_style_pad_all(body_box, 8, 0);

    lv_obj_t * body = add_wrapped_label(body_box, component->text, fg, WALNUT_FONT_SMALL, comic ? 294 : 336);
    lv_obj_align(body, LV_ALIGN_TOP_LEFT, 0, 0);

    lv_obj_t * progress_bg = lv_obj_create(parent);
    lv_obj_set_size(progress_bg, 266, 12);
    set_box_style(progress_bg, soft_bg, border, comic ? 3 : 1, 6);
    lv_obj_align(progress_bg, LV_ALIGN_TOP_LEFT, 8, full_screen ? 236 : 202);

    int progress = clamp_int(component->progress, 0, 100);
    lv_obj_t * progress_fill = lv_obj_create(progress_bg);
    lv_obj_set_size(progress_fill, clamp_int((258 * progress) / 100, 4, 258), 8);
    set_box_style(progress_fill, accent, accent, 0, 4);
    lv_obj_align(progress_fill, LV_ALIGN_LEFT_MID, 2, 0);

    add_generated_items(parent, component->items, fg, soft_bg, border);
}

static void add_component(lv_obj_t * parent, const walnut_screen_component_config_t * component)
{
    if(text_equals(component->type, "generatedPage")) {
        add_generated_page_component(parent, component);
    }
    else if(text_equals(component->type, "progress")) {
        add_progress_component(parent, component);
    }
    else if(text_equals(component->type, "statusCard")) {
        add_text_component(parent, component, 82, WALNUT_FONT_TITLE);
    }
    else if(text_equals(component->type, "metricGroup")) {
        add_text_component(parent, component, 92, WALNUT_FONT_BODY);
    }
    else if(text_equals(component->type, "alert")) {
        add_text_component(parent, component, 78, WALNUT_FONT_BODY);
    }
    else {
        add_text_component(parent, component, 112, WALNUT_FONT_BODY);
    }
}

static void set_page_visible(screen_ui_t * ui, int next_page)
{
    if(ui == NULL || WALNUT_SCREEN_PAGE_COUNT <= 0) return;
    ui->page = clamp_int(next_page, 0, WALNUT_SCREEN_PAGE_COUNT - 1);
    for(int i = 0; i < WALNUT_SCREEN_PAGE_COUNT; i++) {
        if(ui->pages[i] != NULL) {
            if(i == ui->page) lv_obj_clear_flag(ui->pages[i], LV_OBJ_FLAG_HIDDEN);
            else lv_obj_add_flag(ui->pages[i], LV_OBJ_FLAG_HIDDEN);
        }
        if(ui->tabs[i] != NULL) {
            lv_obj_set_style_bg_color(ui->tabs[i], i == ui->page ? lv_color_hex(C_CYAN) : lv_color_hex(C_LINE), 0);
        }
    }
}

static void rotate_page_cb(lv_timer_t * timer)
{
    screen_ui_t * ui = (screen_ui_t *)lv_timer_get_user_data(timer);
    if(ui == NULL || !ui->auto_rotate || WALNUT_SCREEN_PAGE_COUNT < 2) return;
    set_page_visible(ui, (ui->page + 1) % WALNUT_SCREEN_PAGE_COUNT);
}

static void handle_key(screen_ui_t * ui, int code)
{
    if(ui == NULL) return;
    if(code == KEY_RIGHT || code == KEY_DOWN || code == KEY_ENTER) {
        set_page_visible(ui, (ui->page + 1) % WALNUT_SCREEN_PAGE_COUNT);
    }
    else if(code == KEY_LEFT || code == KEY_UP || code == KEY_BACKSPACE) {
        set_page_visible(ui, (ui->page + WALNUT_SCREEN_PAGE_COUNT - 1) % WALNUT_SCREEN_PAGE_COUNT);
    }
    else if(code == KEY_SPACE) {
        ui->auto_rotate = !ui->auto_rotate;
    }
    else if(code == KEY_Q || code == KEY_ESC) {
        running = false;
    }
}

static int open_input_device(void)
{
    const char * candidates[] = {"/dev/input/event0", "/dev/input/event2", NULL};
    for(int i = 0; candidates[i] != NULL; i++) {
        int fd = open(candidates[i], O_RDONLY | O_NONBLOCK);
        if(fd >= 0) return fd;
    }
    return -1;
}

static void input_poll_cb(lv_timer_t * timer)
{
    screen_ui_t * ui = (screen_ui_t *)lv_timer_get_user_data(timer);
    if(ui == NULL || ui->input_fd < 0) return;

    struct input_event ev;
    while(read(ui->input_fd, &ev, sizeof(ev)) == sizeof(ev)) {
        if(ev.type == EV_KEY && ev.value == 1) handle_key(ui, ev.code);
    }
}

static void build_tabs(screen_ui_t * ui, lv_obj_t * scr)
{
    int count = WALNUT_SCREEN_PAGE_COUNT;
    if(count < 2) return;
    int tab_w = clamp_int((304 - (count - 1) * 6) / count, 38, 78);
    int start_x = 464 - (tab_w * count + 6 * (count - 1));

    for(int i = 0; i < count; i++) {
        lv_obj_t * tab = lv_obj_create(scr);
        lv_obj_set_size(tab, tab_w, 20);
        lv_obj_align(tab, LV_ALIGN_TOP_LEFT, start_x + i * (tab_w + 6), 16);
        lv_obj_set_style_radius(tab, 4, 0);
        lv_obj_set_style_bg_color(tab, lv_color_hex(C_LINE), 0);
        lv_obj_set_style_border_width(tab, 0, 0);
        lv_obj_set_style_pad_all(tab, 0, 0);

        lv_obj_t * label = lv_label_create(tab);
        lv_label_set_text(label, walnut_screen_pages[i].tab);
        lv_label_set_long_mode(label, LV_LABEL_LONG_DOT);
        lv_obj_set_width(label, tab_w - 6);
        lv_obj_set_style_text_color(label, lv_color_hex(C_BG), 0);
        lv_obj_set_style_text_font(label, WALNUT_FONT_SMALL, 0);
        lv_obj_center(label);
        ui->tabs[i] = tab;
    }
}

static void build_screen_ui(void)
{
    static screen_ui_t ui;
    memset(&ui, 0, sizeof(ui));
    ui.input_fd = -1;
    ui.auto_rotate = true;

    lv_obj_t * scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_hex(C_BG), 0);
    bool generated_single_page = WALNUT_SCREEN_PAGE_COUNT == 1 && page_has_generated_component(0);

    if(!generated_single_page) {
        lv_obj_t * title = add_wrapped_label(scr, WALNUT_SCREEN_TITLE, lv_color_hex(C_TEXT), WALNUT_FONT_TITLE, 150);
        lv_obj_align(title, LV_ALIGN_TOP_LEFT, 16, 8);

        lv_obj_t * subtitle = add_wrapped_label(scr, WALNUT_SCREEN_SUBTITLE, lv_color_hex(C_MUTED), WALNUT_FONT_SMALL, 150);
        lv_obj_align(subtitle, LV_ALIGN_TOP_LEFT, 18, 36);
    }

    build_tabs(&ui, scr);
    for(int i = 0; i < WALNUT_SCREEN_PAGE_COUNT; i++) {
        ui.pages[i] = create_page(scr);
        if(page_has_generated_component(i)) prepare_generated_page(ui.pages[i], generated_single_page);
    }

    for(int i = 0; i < WALNUT_SCREEN_COMPONENT_COUNT; i++) {
        int page_index = walnut_screen_components[i].page_index;
        if(page_index < 0 || page_index >= WALNUT_SCREEN_PAGE_COUNT) continue;
        add_component(ui.pages[page_index], &walnut_screen_components[i]);
    }

    set_page_visible(&ui, 0);
    lv_timer_create(rotate_page_cb, 6000, &ui);
    ui.input_fd = open_input_device();
    if(ui.input_fd >= 0) lv_timer_create(input_poll_cb, 60, &ui);
}

int main(int argc, char ** argv)
{
    (void)walnut_screen_manifest_hash;

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

    build_screen_ui();

    while(running) {
        lv_tick_inc(5);
        lv_timer_handler();
        usleep(5000);
    }

    return 0;
}
