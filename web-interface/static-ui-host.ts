import path from "node:path";

const DEFAULT_MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".glb", "model/gltf-binary"],
]);

export function createStaticUiHost({ baseDir, files, mime = DEFAULT_MIME }) {
  return {
    async handle(pathname) {
      const file = files.get(pathname);
      if (!file) return null;

      const filePath = path.isAbsolute(file) ? file : path.join(baseDir, file);
      const body = Bun.file(filePath);
      if (!(await body.exists())) {
        return new Response("Not found", { status: 404 });
      }

      return new Response(body, {
        headers: {
          "content-type": contentType(file, mime),
        },
      });
    },
  };
}

function contentType(pathname, mime) {
  const extension = pathname.match(/\.[^.]+$/)?.[0] || "";
  return mime.get(extension) || "application/octet-stream";
}
