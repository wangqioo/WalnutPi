#include "lvgl.h"
#include "generated/screen_config.h"
#include "src/drivers/display/fb/lv_linux_fbdev.h"

#include <signal.h>
#include <arpa/inet.h>
#include <ifaddrs.h>
#include <fcntl.h>
#include <linux/input.h>
#include <net/if.h>
#include <netinet/in.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/statvfs.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

static volatile bool running = true;

#define C_BG 0x05080b
#define C_PANEL 0x11191d
#define C_PANEL_2 0x172329
#define C_LINE 0x33434a
#define C_TEXT 0xf4f1df
#define C_MUTED 0x95a1a6
#define C_CYAN 0x67d6ff
#define C_GREEN 0x33d6a6
#define C_AMBER 0xffc857
#define C_RED 0xff6b6b

#ifndef WALNUT_SCREEN_HOME_TONE_COLOR
#define WALNUT_SCREEN_HOME_TONE_COLOR C_GREEN
#endif

#ifndef WALNUT_SCREEN_HOME_PROGRESS
#define WALNUT_SCREEN_HOME_PROGRESS 72
#endif

typedef struct {
    lv_obj_t * mem_label;
    lv_obj_t * disk_label;
    lv_obj_t * ip_label;
    lv_obj_t * arc;
} demo_status_ui_t;

typedef struct {
    demo_status_ui_t status;
    lv_obj_t * pages[4];
    lv_obj_t * tabs[4];
    lv_obj_t * system_label;
    lv_obj_t * ai_label;
    lv_obj_t * network_label;
    lv_timer_t * rotate_timer;
    int input_fd;
    bool auto_rotate;
    int page;
} screen_ui_t;

static void handle_signal(int sig)
{
    (void)sig;
    running = false;
}

static void add_metric(lv_obj_t * parent, const char * label, const char * value, lv_color_t color)
{
    lv_obj_t * box = lv_obj_create(parent);
    lv_obj_set_size(box, 136, 70);
    lv_obj_set_style_radius(box, 8, 0);
    lv_obj_set_style_bg_color(box, lv_color_hex(0x1f2a2d), 0);
    lv_obj_set_style_border_color(box, color, 0);
    lv_obj_set_style_border_width(box, 2, 0);
    lv_obj_set_style_pad_all(box, 8, 0);

    lv_obj_t * title = lv_label_create(box);
    lv_label_set_text(title, label);
    lv_obj_set_style_text_color(title, lv_color_hex(0x9aa6a1), 0);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_14, 0);

    lv_obj_t * val = lv_label_create(box);
    lv_label_set_text(val, value);
    lv_obj_set_style_text_color(val, color, 0);
    lv_obj_set_style_text_font(val, &lv_font_montserrat_24, 0);
    lv_obj_align(val, LV_ALIGN_BOTTOM_LEFT, 0, 0);
}

static void animate_obj_x(lv_obj_t * obj, int32_t from, int32_t to, uint32_t delay)
{
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, obj);
    lv_anim_set_exec_cb(&a, (lv_anim_exec_xcb_t)lv_obj_set_x);
    lv_anim_set_values(&a, from, to);
    lv_anim_set_duration(&a, 700);
    lv_anim_set_delay(&a, delay);
    lv_anim_set_path_cb(&a, lv_anim_path_custom_bezier3);
    LV_ANIM_SET_EASE_OUT_BACK(&a);
    lv_anim_start(&a);
}

static void set_style_opa_anim(void * obj, int32_t value)
{
    lv_obj_set_style_opa((lv_obj_t *)obj, (lv_opa_t)value, 0);
}

static void set_obj_width_anim(void * obj, int32_t value)
{
    lv_obj_set_width((lv_obj_t *)obj, value);
}

static void style_panel(lv_obj_t * obj, lv_color_t border)
{
    lv_obj_set_style_radius(obj, 6, 0);
    lv_obj_set_style_bg_color(obj, lv_color_hex(C_PANEL), 0);
    lv_obj_set_style_border_color(obj, border, 0);
    lv_obj_set_style_border_width(obj, 1, 0);
}

static void animate_obj_opa(lv_obj_t * obj, int32_t from, int32_t to, uint32_t delay)
{
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, obj);
    lv_anim_set_exec_cb(&a, set_style_opa_anim);
    lv_anim_set_values(&a, from, to);
    lv_anim_set_duration(&a, 650);
    lv_anim_set_delay(&a, delay);
    lv_anim_start(&a);
}

static int read_mem_percent(void)
{
    FILE * f = fopen("/proc/meminfo", "r");
    if(f == NULL) return -1;

    char key[64];
    char unit[32];
    long value;
    long total = 0;
    long available = 0;

    while(fscanf(f, "%63s %ld %31s", key, &value, unit) == 3) {
        if(strcmp(key, "MemTotal:") == 0) total = value;
        if(strcmp(key, "MemAvailable:") == 0) available = value;
        if(total > 0 && available > 0) break;
    }
    fclose(f);

    if(total <= 0 || available < 0) return -1;
    return (int)(((total - available) * 100) / total);
}

static int read_disk_percent(void)
{
    struct statvfs s;
    if(statvfs("/", &s) != 0 || s.f_blocks == 0) return -1;

    unsigned long used = s.f_blocks - s.f_bfree;
    return (int)((used * 100) / s.f_blocks);
}

static void read_ip(char * out, size_t out_size)
{
    struct ifaddrs * ifaddr = NULL;
    if(out_size == 0) return;
    snprintf(out, out_size, "no ip");

    if(getifaddrs(&ifaddr) == -1) return;

    for(struct ifaddrs * ifa = ifaddr; ifa != NULL; ifa = ifa->ifa_next) {
        if(ifa->ifa_addr == NULL) continue;
        if(ifa->ifa_addr->sa_family != AF_INET) continue;
        if((ifa->ifa_flags & IFF_LOOPBACK) != 0) continue;

        struct sockaddr_in * sa = (struct sockaddr_in *)ifa->ifa_addr;
        if(inet_ntop(AF_INET, &sa->sin_addr, out, (socklen_t)out_size) != NULL) break;
    }

    freeifaddrs(ifaddr);
}

static bool service_active(const char * service)
{
    char cmd[128];
    snprintf(cmd, sizeof(cmd), "systemctl is-active --quiet %s", service);
    return system(cmd) == 0;
}

static bool text_contains_ci(const char * text, const char * needle)
{
    if(text == NULL || needle == NULL || needle[0] == '\0') return false;

    size_t needle_len = strlen(needle);
    for(const char * p = text; *p != '\0'; p++) {
        size_t i = 0;
        while(i < needle_len) {
            char a = p[i];
            char b = needle[i];
            if(a >= 'A' && a <= 'Z') a = (char)(a + ('a' - 'A'));
            if(b >= 'A' && b <= 'Z') b = (char)(b + ('a' - 'A'));
            if(a == '\0' || a != b) break;
            i++;
        }
        if(i == needle_len) return true;
    }
    return false;
}

static void read_uptime(char * out, size_t out_size)
{
    FILE * f = fopen("/proc/uptime", "r");
    double uptime = 0.0;
    if(f != NULL) {
        fscanf(f, "%lf", &uptime);
        fclose(f);
    }

    int minutes = (int)(uptime / 60.0);
    int hours = minutes / 60;
    minutes %= 60;
    snprintf(out, out_size, "%dh %02dm", hours, minutes);
}

static void update_demo_status_values(demo_status_ui_t * ui)
{
    if(ui == NULL) return;

    int mem = read_mem_percent();
    int disk = read_disk_percent();
    char ip[32];

    read_ip(ip, sizeof(ip));

    if(text_contains_ci(WALNUT_SCREEN_HOME_METRIC_2, "MEM")) {
        if(mem >= 0) lv_label_set_text_fmt(ui->mem_label, "MEM %d%%", mem);
        else lv_label_set_text(ui->mem_label, "MEM --");
    }
    else {
        lv_label_set_text(ui->mem_label, WALNUT_SCREEN_HOME_METRIC_2);
    }

    if(text_contains_ci(WALNUT_SCREEN_HOME_METRIC_3, "DISK")) {
        if(disk >= 0) lv_label_set_text_fmt(ui->disk_label, "DISK %d%%", disk);
        else lv_label_set_text(ui->disk_label, "DISK --");
    }
    else {
        lv_label_set_text(ui->disk_label, WALNUT_SCREEN_HOME_METRIC_3);
    }

    if(text_contains_ci(WALNUT_SCREEN_HOME_METRIC_1, "IP")) {
        lv_label_set_text_fmt(ui->ip_label, "IP %s", ip);
    }
    else {
        lv_label_set_text(ui->ip_label, WALNUT_SCREEN_HOME_METRIC_1);
    }

}

static void update_demo_status(lv_timer_t * timer)
{
    update_demo_status_values((demo_status_ui_t *)lv_timer_get_user_data(timer));
}

static void set_page_visible(screen_ui_t * ui, int next_page)
{
    if(ui == NULL) return;
    ui->page = next_page;
    for(int i = 0; i < 4; i++) {
        if(ui->pages[i] != NULL) {
            if(i == next_page) lv_obj_clear_flag(ui->pages[i], LV_OBJ_FLAG_HIDDEN);
            else lv_obj_add_flag(ui->pages[i], LV_OBJ_FLAG_HIDDEN);
        }
        if(ui->tabs[i] != NULL) {
            lv_obj_set_style_bg_color(ui->tabs[i], i == next_page ? lv_color_hex(C_CYAN) : lv_color_hex(C_LINE), 0);
        }
    }
}

static void rotate_page_cb(lv_timer_t * timer)
{
    screen_ui_t * ui = (screen_ui_t *)lv_timer_get_user_data(timer);
    if(ui == NULL || !ui->auto_rotate) return;
    set_page_visible(ui, (ui->page + 1) % 4);
}

static void handle_key(screen_ui_t * ui, int code)
{
    if(ui == NULL) return;
    if(code == KEY_RIGHT || code == KEY_DOWN || code == KEY_ENTER) {
        set_page_visible(ui, (ui->page + 1) % 4);
    }
    else if(code == KEY_LEFT || code == KEY_UP || code == KEY_BACKSPACE) {
        set_page_visible(ui, (ui->page + 3) % 4);
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
    const char * candidates[] = {
        "/dev/input/event0",
        "/dev/input/event2",
        NULL,
    };
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
        if(ev.type == EV_KEY && ev.value == 1) {
            handle_key(ui, ev.code);
        }
    }
}

static void update_screen_page_values(screen_ui_t * ui)
{
    if(ui == NULL) return;

    int mem = read_mem_percent();
    int disk = read_disk_percent();
    double loads[3] = {0};
    char ip[32];
    char uptime[32];

    read_ip(ip, sizeof(ip));
    read_uptime(uptime, sizeof(uptime));
    getloadavg(loads, 3);

    if(ui->system_label != NULL) {
        lv_label_set_text_fmt(ui->system_label,
                              "%s\n\n%s  %.2f\n%s    %d%%\n%s      %d%%\n%s    %s",
                              WALNUT_SCREEN_SYSTEM_TITLE,
                              WALNUT_SCREEN_SYSTEM_LINE_1[0] ? WALNUT_SCREEN_SYSTEM_LINE_1 : "CPU load",
                              loads[0],
                              WALNUT_SCREEN_SYSTEM_LINE_2[0] ? WALNUT_SCREEN_SYSTEM_LINE_2 : "Memory",
                              mem,
                              WALNUT_SCREEN_SYSTEM_LINE_3[0] ? WALNUT_SCREEN_SYSTEM_LINE_3 : "Disk",
                              disk,
                              WALNUT_SCREEN_SYSTEM_LINE_4[0] ? WALNUT_SCREEN_SYSTEM_LINE_4 : "Uptime",
                              uptime);
    }

    if(ui->ai_label != NULL) {
        char ai_text[384] = {0};
        FILE * f = fopen("/run/walnut-screen-ai.txt", "r");
        if(f != NULL) {
            size_t n = fread(ai_text, 1, sizeof(ai_text) - 1, f);
            ai_text[n] = '\0';
            fclose(f);
        }
        if(ai_text[0] != '\0') {
            lv_label_set_text_fmt(ui->ai_label, "AI Agent\n\n%s", ai_text);
        }
        else {
            lv_label_set_text(ui->ai_label, WALNUT_SCREEN_AI_TEXT);
        }
    }

    if(ui->network_label != NULL) {
        bool frp = service_active("frpc.service") || service_active("frpc");
        lv_label_set_text_fmt(ui->network_label,
                              "%s\n\n%s       %s\n%s      %s\n%s      ready\n%s  fbdev",
                              WALNUT_SCREEN_NETWORK_TITLE,
                              WALNUT_SCREEN_NETWORK_LINE_1[0] ? WALNUT_SCREEN_NETWORK_LINE_1 : "IP",
                              ip,
                              WALNUT_SCREEN_NETWORK_LINE_2[0] ? WALNUT_SCREEN_NETWORK_LINE_2 : "FRP",
                              frp ? "online" : "offline",
                              WALNUT_SCREEN_NETWORK_LINE_3[0] ? WALNUT_SCREEN_NETWORK_LINE_3 : "SSH",
                              WALNUT_SCREEN_NETWORK_LINE_4[0] ? WALNUT_SCREEN_NETWORK_LINE_4 : "Display");
    }
}

static void update_screen_pages(lv_timer_t * timer)
{
    update_screen_page_values((screen_ui_t *)lv_timer_get_user_data(timer));
}

static void animate_arc_rotation(lv_obj_t * arc)
{
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, arc);
    lv_anim_set_exec_cb(&a, (lv_anim_exec_xcb_t)lv_arc_set_rotation);
    lv_anim_set_values(&a, 0, 360);
    lv_anim_set_duration(&a, 1800);
    lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
    lv_anim_start(&a);
}

static void animate_arc_value(lv_obj_t * arc, int32_t start, int32_t end, uint32_t duration)
{
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, arc);
    lv_anim_set_exec_cb(&a, (lv_anim_exec_xcb_t)lv_arc_set_value);
    lv_anim_set_values(&a, start, end);
    lv_anim_set_duration(&a, duration);
    lv_anim_set_playback_duration(&a, duration);
    lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
    lv_anim_set_path_cb(&a, lv_anim_path_custom_bezier3);
    LV_ANIM_SET_EASE_IN_OUT_SINE(&a);
    lv_anim_start(&a);
}

static int clamp_percent(int value)
{
    if(value < 0) return 0;
    if(value > 100) return 100;
    return value;
}

static void animate_obj_y(lv_obj_t * obj, int32_t from, int32_t to, uint32_t delay)
{
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, obj);
    lv_anim_set_exec_cb(&a, (lv_anim_exec_xcb_t)lv_obj_set_y);
    lv_anim_set_values(&a, from, to);
    lv_anim_set_duration(&a, 900);
    lv_anim_set_playback_duration(&a, 900);
    lv_anim_set_delay(&a, delay);
    lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
    lv_anim_set_path_cb(&a, lv_anim_path_custom_bezier3);
    LV_ANIM_SET_EASE_IN_OUT_SINE(&a);
    lv_anim_start(&a);
}

static void animate_width(lv_obj_t * obj, int32_t from, int32_t to, uint32_t delay)
{
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, obj);
    lv_anim_set_exec_cb(&a, set_obj_width_anim);
    lv_anim_set_values(&a, from, to);
    lv_anim_set_duration(&a, 1300);
    lv_anim_set_playback_duration(&a, 1300);
    lv_anim_set_delay(&a, delay);
    lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
    lv_anim_set_path_cb(&a, lv_anim_path_custom_bezier3);
    LV_ANIM_SET_EASE_IN_OUT_SINE(&a);
    lv_anim_start(&a);
}

static void animate_pulse(lv_obj_t * obj, uint32_t delay)
{
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, obj);
    lv_anim_set_exec_cb(&a, set_style_opa_anim);
    lv_anim_set_values(&a, 90, 255);
    lv_anim_set_duration(&a, 850);
    lv_anim_set_playback_duration(&a, 850);
    lv_anim_set_delay(&a, delay);
    lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
    lv_anim_start(&a);
}

static void build_ui(void)
{
    lv_obj_t * scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_hex(0x071014), 0);

    lv_obj_t * root = lv_obj_create(scr);
    lv_obj_set_size(root, 480, 320);
    lv_obj_center(root);
    lv_obj_set_style_bg_color(root, lv_color_hex(0x071014), 0);
    lv_obj_set_style_border_width(root, 0, 0);
    lv_obj_set_style_pad_all(root, 14, 0);

    lv_obj_t * header = lv_obj_create(root);
    lv_obj_set_size(header, 452, 62);
    lv_obj_set_style_radius(header, 8, 0);
    lv_obj_set_style_bg_color(header, lv_color_hex(0x132126), 0);
    lv_obj_set_style_border_color(header, lv_color_hex(0x54d6c8), 0);
    lv_obj_set_style_border_width(header, 2, 0);
    lv_obj_align(header, LV_ALIGN_TOP_MID, 0, 0);

    lv_obj_t * title = lv_label_create(header);
    lv_label_set_text(title, "WalnutPi LVGL");
    lv_obj_set_style_text_color(title, lv_color_hex(0xf0efe7), 0);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_28, 0);
    lv_obj_align(title, LV_ALIGN_LEFT_MID, 14, -8);

    lv_obj_t * sub = lv_label_create(header);
    lv_label_set_text(sub, "fbdev UI runtime");
    lv_obj_set_style_text_color(sub, lv_color_hex(0x54d6c8), 0);
    lv_obj_set_style_text_font(sub, &lv_font_montserrat_14, 0);
    lv_obj_align(sub, LV_ALIGN_LEFT_MID, 16, 20);

    lv_obj_t * metrics = lv_obj_create(root);
    lv_obj_set_size(metrics, 452, 80);
    lv_obj_set_style_bg_opa(metrics, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(metrics, 0, 0);
    lv_obj_set_style_pad_all(metrics, 0, 0);
    lv_obj_set_flex_flow(metrics, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(metrics, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_align(metrics, LV_ALIGN_TOP_MID, 0, 82);

    add_metric(metrics, "FRP", "ON", lv_color_hex(0x75dc88));
    add_metric(metrics, "DISK", "36%", lv_color_hex(0xe8b444));
    add_metric(metrics, "MEM", "27%", lv_color_hex(0x75dc88));

    lv_obj_t * log = lv_obj_create(root);
    lv_obj_set_size(log, 452, 126);
    lv_obj_set_style_radius(log, 8, 0);
    lv_obj_set_style_bg_color(log, lv_color_hex(0x10191d), 0);
    lv_obj_set_style_border_color(log, lv_color_hex(0x5a6969), 0);
    lv_obj_set_style_border_width(log, 2, 0);
    lv_obj_align(log, LV_ALIGN_BOTTOM_MID, 0, -8);

    lv_obj_t * body = lv_label_create(log);
    lv_label_set_text(body,
                      "Status page is rendered by LVGL\\n"
                      "No X11 / Wayland / desktop\\n"
                      "Framebuffer: /dev/fb0 RGB565\\n"
                      "Next: evdev touch input");
    lv_obj_set_style_text_color(body, lv_color_hex(0xf0efe7), 0);
    lv_obj_set_style_text_font(body, &lv_font_montserrat_18, 0);
    lv_obj_align(body, LV_ALIGN_TOP_LEFT, 14, 14);
}

static lv_obj_t * demo_line(lv_obj_t * parent, int y, const char * label, lv_color_t color, uint32_t delay)
{
    lv_obj_t * row = lv_obj_create(parent);
    lv_obj_set_size(row, 196, 36);
    lv_obj_set_style_radius(row, 7, 0);
    lv_obj_set_style_bg_color(row, lv_color_hex(0x10191d), 0);
    lv_obj_set_style_border_color(row, color, 0);
    lv_obj_set_style_border_width(row, 1, 0);
    lv_obj_set_style_pad_all(row, 8, 0);
    lv_obj_align(row, LV_ALIGN_TOP_LEFT, 250, y);
    lv_obj_set_style_opa(row, 0, 0);

    lv_obj_t * text = lv_label_create(row);
    lv_label_set_text(text, label);
    lv_obj_set_style_text_color(text, lv_color_hex(0xf0efe7), 0);
    lv_obj_set_style_text_font(text, &lv_font_montserrat_14, 0);

    animate_obj_x(row, 520, 250, delay);
    animate_obj_opa(row, 0, 255, delay + 120);
    return row;
}

static lv_obj_t * demo_metric(lv_obj_t * parent, int y, const char * label, lv_color_t color, uint32_t delay, lv_obj_t ** value_label)
{
    lv_obj_t * row = lv_obj_create(parent);
    lv_obj_set_size(row, 196, 34);
    style_panel(row, color);
    lv_obj_set_style_pad_all(row, 7, 0);
    lv_obj_align(row, LV_ALIGN_TOP_LEFT, 250, y);
    lv_obj_set_style_opa(row, 0, 0);

    lv_obj_t * text = lv_label_create(row);
    lv_label_set_text(text, label);
    lv_obj_set_style_text_color(text, lv_color_hex(C_TEXT), 0);
    lv_obj_set_style_text_font(text, &lv_font_montserrat_14, 0);
    if(value_label != NULL) *value_label = text;

    animate_obj_x(row, 520, 250, delay);
    animate_obj_opa(row, 0, 255, delay + 120);
    return row;
}

static lv_obj_t * create_page(lv_obj_t * parent)
{
    lv_obj_t * page = lv_obj_create(parent);
    lv_obj_set_size(page, 480, 272);
    lv_obj_align(page, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_set_style_bg_opa(page, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(page, 0, 0);
    lv_obj_set_style_pad_all(page, 0, 0);
    return page;
}

static lv_obj_t * add_text_page(lv_obj_t * parent, const char * text, lv_color_t color)
{
    lv_obj_t * panel = lv_obj_create(parent);
    lv_obj_set_size(panel, 430, 212);
    lv_obj_align(panel, LV_ALIGN_CENTER, 0, 8);
    style_panel(panel, color);
    lv_obj_set_style_border_width(panel, 2, 0);
    lv_obj_set_style_pad_all(panel, 18, 0);

    lv_obj_t * label = lv_label_create(panel);
    lv_label_set_text(label, text);
    lv_obj_set_style_text_color(label, lv_color_hex(C_TEXT), 0);
    lv_obj_set_style_text_font(label, &lv_font_montserrat_18, 0);
    lv_obj_set_width(label, 390);
    lv_obj_align(label, LV_ALIGN_TOP_LEFT, 0, 0);
    return label;
}

static void add_spinner_badge(lv_obj_t * parent, int x, int y, lv_color_t color)
{
    lv_obj_t * arc = lv_arc_create(parent);
    lv_obj_set_size(arc, 56, 56);
    lv_obj_align(arc, LV_ALIGN_TOP_LEFT, x, y);
    lv_arc_set_range(arc, 0, 100);
    lv_arc_set_value(arc, 68);
    lv_arc_set_bg_angles(arc, 0, 360);
    lv_arc_set_angles(arc, 35, 275);
    lv_obj_remove_style(arc, NULL, LV_PART_KNOB);
    lv_obj_set_style_arc_width(arc, 5, LV_PART_MAIN);
    lv_obj_set_style_arc_width(arc, 7, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(arc, lv_color_hex(C_PANEL_2), LV_PART_MAIN);
    lv_obj_set_style_arc_color(arc, color, LV_PART_INDICATOR);
    animate_arc_rotation(arc);
}

static void add_pulse_dots(lv_obj_t * parent, int x, int y, lv_color_t color)
{
    for(int i = 0; i < 3; i++) {
        lv_obj_t * dot = lv_obj_create(parent);
        lv_obj_set_size(dot, 18, 18);
        lv_obj_set_style_radius(dot, 9, 0);
        lv_obj_set_style_bg_color(dot, color, 0);
        lv_obj_set_style_border_width(dot, 0, 0);
        lv_obj_align(dot, LV_ALIGN_TOP_LEFT, x + i * 28, y);
        animate_pulse(dot, (uint32_t)i * 220);
        animate_obj_y(dot, y - 3, y + 7, (uint32_t)i * 160);
    }
}

static void add_scan_line(lv_obj_t * parent, int x, int y, lv_color_t color)
{
    lv_obj_t * track = lv_obj_create(parent);
    lv_obj_set_size(track, 150, 10);
    lv_obj_set_style_radius(track, 5, 0);
    lv_obj_set_style_bg_color(track, lv_color_hex(C_PANEL_2), 0);
    lv_obj_set_style_border_width(track, 0, 0);
    lv_obj_align(track, LV_ALIGN_TOP_LEFT, x, y);

    lv_obj_t * line = lv_obj_create(track);
    lv_obj_set_size(line, 26, 10);
    lv_obj_set_style_radius(line, 5, 0);
    lv_obj_set_style_bg_color(line, color, 0);
    lv_obj_set_style_border_width(line, 0, 0);
    lv_obj_align(line, LV_ALIGN_LEFT_MID, 0, 0);
    animate_width(line, 24, 142, 0);
}

static void build_tabs(screen_ui_t * ui, lv_obj_t * scr)
{
    static const char * names[] = {
        WALNUT_SCREEN_TAB_HOME,
        WALNUT_SCREEN_TAB_SYSTEM,
        WALNUT_SCREEN_TAB_AI,
        WALNUT_SCREEN_TAB_NETWORK
    };
    for(int i = 0; i < 4; i++) {
        lv_obj_t * tab = lv_obj_create(scr);
        lv_obj_set_size(tab, 78, 20);
        lv_obj_align(tab, LV_ALIGN_TOP_LEFT, 138 + i * 84, 16);
        lv_obj_set_style_radius(tab, 4, 0);
        lv_obj_set_style_bg_color(tab, lv_color_hex(C_LINE), 0);
        lv_obj_set_style_border_width(tab, 0, 0);
        lv_obj_set_style_pad_all(tab, 0, 0);

        lv_obj_t * label = lv_label_create(tab);
        lv_label_set_text(label, names[i]);
        lv_obj_set_style_text_color(label, lv_color_hex(C_BG), 0);
        lv_obj_set_style_text_font(label, &lv_font_montserrat_14, 0);
        lv_obj_center(label);
        ui->tabs[i] = tab;
    }
}

static void type_log_cb(lv_timer_t * timer)
{
    static const char * lines[] = {
        "> booting walnut agent",
        "> fbdev display locked",
        "> lvgl animations online",
        "> cloud ai channel ready",
        "> waiting for local tasks"
    };
    static size_t index = 0;
    lv_obj_t * label = (lv_obj_t *)lv_timer_get_user_data(timer);
    lv_label_set_text(label, lines[index]);
    index = (index + 1) % (sizeof(lines) / sizeof(lines[0]));
}

static void build_demo_ui(void)
{
    static screen_ui_t ui;
    memset(&ui, 0, sizeof(ui));
    ui.input_fd = -1;
    ui.auto_rotate = true;

    lv_obj_t * scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_hex(C_BG), 0);

    lv_obj_t * title = lv_label_create(scr);
    lv_label_set_text(title, WALNUT_SCREEN_TITLE);
    lv_obj_set_style_text_color(title, lv_color_hex(C_TEXT), 0);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_24, 0);
    lv_obj_align(title, LV_ALIGN_TOP_LEFT, 16, 10);

    lv_obj_t * subtitle = lv_label_create(scr);
    lv_label_set_text(subtitle, WALNUT_SCREEN_SUBTITLE);
    lv_obj_set_style_text_color(subtitle, lv_color_hex(C_MUTED), 0);
    lv_obj_set_style_text_font(subtitle, &lv_font_montserrat_14, 0);
    lv_obj_align(subtitle, LV_ALIGN_TOP_LEFT, 18, 36);

    build_tabs(&ui, scr);
    ui.pages[0] = create_page(scr);
    ui.pages[1] = create_page(scr);
    ui.pages[2] = create_page(scr);
    ui.pages[3] = create_page(scr);

    lv_obj_t * arc = lv_arc_create(ui.pages[0]);
    lv_obj_set_size(arc, 168, 168);
    lv_obj_align(arc, LV_ALIGN_LEFT_MID, 24, 8);
    lv_arc_set_range(arc, 0, 100);
    int progress = clamp_percent(WALNUT_SCREEN_HOME_PROGRESS);
    lv_arc_set_value(arc, progress);
    lv_arc_set_bg_angles(arc, 0, 360);
    lv_arc_set_angles(arc, 18, 286);
    lv_obj_remove_style(arc, NULL, LV_PART_KNOB);
    lv_obj_set_style_arc_width(arc, 8, LV_PART_MAIN);
    lv_obj_set_style_arc_width(arc, 10, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(arc, lv_color_hex(C_PANEL_2), LV_PART_MAIN);
    lv_obj_set_style_arc_color(arc, lv_color_hex(WALNUT_SCREEN_HOME_TONE_COLOR), LV_PART_INDICATOR);
    animate_arc_rotation(arc);
    animate_arc_value(arc, clamp_percent(progress - 18), clamp_percent(progress + 18), 1500);
    ui.status.arc = arc;

    lv_obj_t * core = lv_obj_create(ui.pages[0]);
    lv_obj_set_size(core, 96, 96);
    lv_obj_set_style_radius(core, 48, 0);
    lv_obj_set_style_bg_color(core, lv_color_hex(C_PANEL_2), 0);
    lv_obj_set_style_border_color(core, lv_color_hex(WALNUT_SCREEN_HOME_TONE_COLOR), 0);
    lv_obj_set_style_border_width(core, 2, 0);
    lv_obj_align_to(core, arc, LV_ALIGN_CENTER, 0, 0);
    animate_pulse(core, 0);

    lv_obj_t * core_text = lv_label_create(core);
    lv_label_set_text(core_text, WALNUT_SCREEN_HOME_STATUS);
    lv_obj_set_style_text_align(core_text, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(core_text, lv_color_hex(C_TEXT), 0);
    lv_obj_set_style_text_font(core_text, &lv_font_montserrat_18, 0);
    lv_obj_center(core_text);

    demo_metric(ui.pages[0], 82, WALNUT_SCREEN_HOME_METRIC_1, lv_color_hex(WALNUT_SCREEN_HOME_TONE_COLOR), 120, &ui.status.ip_label);
    demo_metric(ui.pages[0], 122, WALNUT_SCREEN_HOME_METRIC_2, lv_color_hex(C_AMBER), 260, &ui.status.mem_label);
    demo_metric(ui.pages[0], 162, WALNUT_SCREEN_HOME_METRIC_3, lv_color_hex(C_RED), 400, &ui.status.disk_label);

    ui.system_label = add_text_page(ui.pages[1], WALNUT_SCREEN_SYSTEM_TEXT, lv_color_hex(C_AMBER));
    add_spinner_badge(ui.pages[1], 356, 82, lv_color_hex(C_AMBER));
    add_scan_line(ui.pages[1], 278, 182, lv_color_hex(C_AMBER));

    ui.ai_label = add_text_page(ui.pages[2], WALNUT_SCREEN_AI_TEXT, lv_color_hex(C_GREEN));
    add_pulse_dots(ui.pages[2], 318, 92, lv_color_hex(C_GREEN));
    add_scan_line(ui.pages[2], 278, 182, lv_color_hex(C_GREEN));

    ui.network_label = add_text_page(ui.pages[3], WALNUT_SCREEN_NETWORK_TEXT, lv_color_hex(C_CYAN));
    add_spinner_badge(ui.pages[3], 356, 82, lv_color_hex(C_CYAN));
    add_pulse_dots(ui.pages[3], 304, 184, lv_color_hex(C_CYAN));

    update_demo_status_values(&ui.status);
    update_screen_page_values(&ui);
    set_page_visible(&ui, 0);
    lv_timer_create(update_demo_status, 2000, &ui.status);
    lv_timer_create(update_screen_pages, 2000, &ui);
    ui.rotate_timer = lv_timer_create(rotate_page_cb, 6000, &ui);
    ui.input_fd = open_input_device();
    if(ui.input_fd >= 0) lv_timer_create(input_poll_cb, 60, &ui);
}

int main(int argc, char ** argv)
{
    const char * fbdev = "/dev/fb0";
    bool demo = false;
    for(int i = 1; i < argc; i++) {
        if(strcmp(argv[i], "--demo") == 0) {
            demo = true;
        }
        else {
            fbdev = argv[i];
        }
    }

    signal(SIGINT, handle_signal);
    signal(SIGTERM, handle_signal);

    lv_init();
    lv_display_t * disp = lv_linux_fbdev_create();
    if(disp == NULL) {
        fprintf(stderr, "failed to create LVGL fbdev display\\n");
        return 1;
    }
    lv_linux_fbdev_set_file(disp, fbdev);
    lv_linux_fbdev_set_force_refresh(disp, true);

    if(demo) {
        build_demo_ui();
    }
    else {
        build_ui();
    }

    while(running) {
        lv_tick_inc(5);
        lv_timer_handler();
        usleep(5000);
    }

    if(demo) {
        /* Process cleanup is handled by systemd; LVGL objects are process lifetime. */
    }

    return 0;
}
