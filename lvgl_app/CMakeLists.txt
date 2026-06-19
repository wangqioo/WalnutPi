cmake_minimum_required(VERSION 3.16)
project(walnut_lvgl_fbdev C)

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)

set(LVGL_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../third_party/lvgl" CACHE PATH "Path to LVGL source")

if(NOT EXISTS "${LVGL_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "LVGL source not found at ${LVGL_DIR}. Run scripts/fetch-lvgl.sh first.")
endif()

set(LV_CONF_PATH "${CMAKE_CURRENT_SOURCE_DIR}/lv_conf.h" CACHE STRING "LVGL config path" FORCE)
set(LV_CONF_BUILD_DISABLE_EXAMPLES ON CACHE BOOL "Disable LVGL examples" FORCE)
set(LV_CONF_BUILD_DISABLE_DEMOS OFF CACHE BOOL "Disable LVGL demos" FORCE)
set(LV_CONF_BUILD_DISABLE_THORVG_INTERNAL ON CACHE BOOL "Disable LVGL ThorVG" FORCE)

include_directories(
  "${CMAKE_CURRENT_SOURCE_DIR}"
  "${LVGL_DIR}"
)

add_subdirectory("${LVGL_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/lvgl")

get_target_property(LVGL_SOURCES lvgl SOURCES)
list(FILTER LVGL_SOURCES EXCLUDE REGEX "\\.S$")
if(WIN32)
  list(FILTER LVGL_SOURCES EXCLUDE REGEX "/src/drivers/")
endif()
set_target_properties(lvgl PROPERTIES SOURCES "${LVGL_SOURCES}")

if(NOT WIN32)
  add_executable(walnut-lvgl-screen
    src/main.c
  )

  target_link_libraries(walnut-lvgl-screen PRIVATE lvgl m)
endif()

add_executable(walnut-lvgl-preview
  src/main.c
  src/preview_main.c
)

target_compile_definitions(walnut-lvgl-preview PRIVATE WALNUT_LVGL_NO_FBDEV=1)
target_link_libraries(walnut-lvgl-preview PRIVATE lvgl lvgl::demos)
if(NOT WIN32)
  target_link_libraries(walnut-lvgl-preview PRIVATE m)
endif()
