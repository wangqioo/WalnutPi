import {
  firstScreenComponent,
  metricItemFromText,
  normalizeScreenManifest,
  toneFromText,
} from "../scripts/screen-manifest-vocabulary.js";

function pageStub(page, index) {
  return { id: page?.id || `page-${index + 1}` };
}

function mutableManifestView(manifest) {
  return {
    title: manifest.title,
    subtitle: manifest.subtitle,
    pages: manifest.pages,
  };
}

function mergeScreenComponents(baseComponents, patchComponents) {
  if (patchComponents === undefined) return baseComponents;
  if (!Array.isArray(patchComponents)) return patchComponents;
  const merged = Array.isArray(baseComponents) ? [...baseComponents] : [];
  for (const component of patchComponents) {
    const type = component?.type;
    const existingIndex = merged.findIndex((item) => item?.type === type);
    if (type && existingIndex >= 0) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...component,
      };
    } else {
      merged.push(component);
    }
  }
  return merged;
}

function mergePageComponents(basePage, mutablePage) {
  if (!mutablePage) return basePage?.components;
  if (mutablePage.components !== undefined) {
    return mergeScreenComponents(basePage?.components, mutablePage.components);
  }
  return basePage?.components;
}

function applyMutableManifest(baseManifest, mutable) {
  const basePages = baseManifest.pages || [];
  const hasPagePatch = Array.isArray(mutable.pages);
  const mutablePages = hasPagePatch ? mutable.pages : basePages.map(pageStub);
  const replacePages = Boolean(mutable.replacePages);
  return normalizeScreenManifest({
    ...baseManifest,
    title: mutable.title ?? baseManifest.title,
    subtitle: mutable.subtitle ?? baseManifest.subtitle,
    pages: mutablePages.map((mutablePage, index) => ({
      ...(replacePages ? {} : basePages[index] || pageStub(mutablePage, index)),
      ...(mutablePages[index] || {}),
      components: mergePageComponents(basePages[index], mutablePages[index]),
      id: mutablePage?.id || basePages[index]?.id || `page-${index + 1}`,
    })),
  });
}

function splitIntentItems(value) {
  return String(value || "")
    .split(/[，,、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function splitGroupedIntentItems(value, maxItems) {
  const text = String(value || "");
  const grouped = text
    .split(/[，,、;；\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (grouped.length > 1) return grouped.slice(0, maxItems);
  return splitIntentItems(text).slice(0, maxItems);
}

function patchPages(currentManifest, updater) {
  const pages = (currentManifest.pages || []).map(pageStub);
  updater(pages);
  return { pages };
}

function componentPage(id, tab, component) {
  return { id, tab, components: [component] };
}

function firstPageComponentPatch(currentManifest, component) {
  return patchPages(currentManifest, (pages) => {
    const first = currentManifest.pages?.[0] || {};
    pages[0] = componentPage(first.id || "main", first.tab || "MAIN", component);
  });
}

function currentFirstComponent(currentManifest, type) {
  return firstScreenComponent(currentManifest.pages?.[0]?.components || [], type);
}

function currentTextComponent(currentManifest, pageIndex, type) {
  return firstScreenComponent(currentManifest.pages?.[pageIndex]?.components || [], type);
}

function pageComponentPatch(currentManifest, pageIndex, tab, component) {
  return patchPages(currentManifest, (pages) => {
    const current = currentManifest.pages?.[pageIndex] || {};
    pages[pageIndex] = componentPage(current.id || `page-${pageIndex + 1}`, current.tab || tab, component);
  });
}

function linePagePatch(currentManifest, pageIndex, title, lines, tab) {
  return patchPages(currentManifest, (pages) => {
    const current = currentManifest.pages?.[pageIndex] || {};
    pages[pageIndex] = {
      id: current.id || `page-${pageIndex + 1}`,
      tab,
      components: [{ type: "textPage", title, lines }],
    };
  });
}

function screenTemplateSummary(template) {
  return {
    id: template.id,
    label: template.label,
    summary: template.summary,
    manifest: mutableManifestView(applyMutableManifest({
      id: `preview-${template.id}`,
      schema: "walnutpi.screen.v1",
      title: "Preview",
      subtitle: "template",
      target: { runtime: "lvgl-fbdev", display: "/dev/fb0", width: 480, height: 320, color: "RGB565" },
      source: { lvglEntry: "lvgl_app/src/main.c", command: "walnut screen start" },
      pages: template.manifest.pages.map(pageStub),
    }, template.manifest)),
  };
}

export function createScreenManifestEditor({
  templates,
  manifestStore,
  json,
  readJsonRequest,
  looksLikeScreenProgramRequest,
  buildAiScreenManifestCandidate,
  screenProgramIntentSummary,
  screenProgramIntentPatch,
  screenProgramSubject,
}) {
  async function currentManifestForWrite(body) {
    const current = await manifestStore.currentForWrite(body);
    if (!current.ok) return { error: json(current.response, current.status) };
    return current;
  }

  async function writeScreenManifest(manifest) {
    return manifestStore.write(manifest);
  }

  function parseScreenIntent(text, currentManifest) {
    const input = String(text || "").trim();
    if (!input) return null;

    const programPatch = typeof screenProgramIntentPatch === "function" ? screenProgramIntentPatch(input) : null;
    if (programPatch) return programPatch;

    let match = input.match(/(?:副标题|说明)\s*(?:改成|改为|写成|是|:|：)\s*(.+)$/);
    if (match) return { subtitle: match[1].trim() };

    match = input.match(/(?:标题|名字|名称)\s*(?:改成|改为|写成|叫|是|:|：)\s*(.+)$/);
    if (match) return { title: match[1].trim() };

    match = input.match(/(?:状态|核心状态)\s*(?:改成|改为|写成|写|是|:|：)\s*(.+)$/);
    if (match) {
      const status = match[1].trim();
      const tone = toneFromText(status);
      return firstPageComponentPatch(currentManifest, {
        type: "statusCard",
        label: currentFirstComponent(currentManifest, "statusCard")?.label || "Status",
        value: status,
        tone,
        detail: currentFirstComponent(currentManifest, "statusCard")?.detail || "Ready",
      });
    }

    match = input.match(/(?:状态标签|状态卡标签|状态名)\s*(?:改成|改为|写成|是|:|：)\s*(.+)$/);
    if (match) {
      const statusCard = currentFirstComponent(currentManifest, "statusCard") || {};
      return firstPageComponentPatch(currentManifest, {
        type: "statusCard",
        label: match[1].trim(),
        value: statusCard.value || "Ready",
        tone: statusCard.tone || "ok",
        detail: statusCard.detail || "Ready",
      });
    }

    match = input.match(/(?:状态详情|状态说明|详情)\s*(?:改成|改为|写成|是|:|：)\s*(.+)$/);
    if (match) {
      const statusCard = currentFirstComponent(currentManifest, "statusCard") || {};
      return firstPageComponentPatch(currentManifest, {
        type: "statusCard",
        label: statusCard.label || "Status",
        value: statusCard.value || "Ready",
        tone: statusCard.tone || "ok",
        detail: match[1].trim(),
      });
    }

    match = input.match(/(?:进度|完成度)\s*(?:改成|改为|写成|是|:|：)?\s*(\d{1,3})\s*%?$/);
    if (match) {
      return firstPageComponentPatch(currentManifest, {
        type: "progress",
        label: currentFirstComponent(currentManifest, "progress")?.label || "Progress",
        value: Number(match[1]),
        max: 100,
        tone: currentFirstComponent(currentManifest, "progress")?.tone || "ok",
      });
    }

    match = input.match(/(?:进度标签|进度名|进度说明)\s*(?:改成|改为|写成|是|:|：)\s*(.+)$/);
    if (match) {
      const progress = currentFirstComponent(currentManifest, "progress") || {};
      return firstPageComponentPatch(currentManifest, {
        type: "progress",
        label: match[1].trim(),
        value: progress.value ?? 72,
        max: progress.max || 100,
        tone: progress.tone || "ok",
      });
    }

    match = input.match(/(?:状态色|语义|告警级别|等级)\s*(?:改成|改为|写成|是|:|：)?\s*(正常|健康|ok|OK|告警|警告|warn|warning|错误|失败|error|ERROR)$/);
    if (match) {
      const raw = match[1];
      const tone = /错误|失败|error/i.test(raw) ? "error" : /告警|警告|warn|warning/i.test(raw) ? "warn" : "ok";
      return patchPages(currentManifest, (pages) => {
        const first = currentManifest.pages?.[0] || {};
        pages[0] = {
          id: first.id || "main",
          tab: first.tab || "MAIN",
          components: [
            {
              type: "statusCard",
              label: currentFirstComponent(currentManifest, "statusCard")?.label || "Status",
              value: currentFirstComponent(currentManifest, "statusCard")?.value || "Ready",
              tone,
              detail: currentFirstComponent(currentManifest, "statusCard")?.detail || "Ready",
            },
            {
              type: "progress",
              label: currentFirstComponent(currentManifest, "progress")?.label || "Progress",
              value: currentFirstComponent(currentManifest, "progress")?.value ?? 72,
              max: 100,
              tone,
            },
          ],
        };
      });
    }

    match = input.match(/(?:告警|警告|提示)\s*(?:改成|改为|写成|写|是|:|：)\s*(.+)$/);
    if (match) {
      return pageComponentPatch(currentManifest, Math.min(1, currentManifest.pages.length - 1), currentManifest.pages[1]?.tab || "WARN", {
        type: "alert",
        title: "Alert",
        body: match[1].trim(),
        tone: toneFromText(match[1]),
      });
    }

    match = input.match(/(?:指标组|组件指标)\s*(?:改成|改为|写成|写|:|：)?\s*(.+)$/);
    if (match) {
      const metrics = splitGroupedIntentItems(match[1], 3);
      if (metrics.length > 0) {
        return firstPageComponentPatch(currentManifest, {
          type: "metricGroup",
          items: metrics.map(metricItemFromText),
        });
      }
    }

    match = input.match(/(?:列表|清单|步骤)\s*(?:改成|改为|写成|写|显示|:|：)\s*(.+)$/);
    if (match) {
      const items = splitIntentItems(match[1]).slice(0, 4);
      if (items.length > 0) {
        return pageComponentPatch(currentManifest, Math.min(1, currentManifest.pages.length - 1), currentManifest.pages[1]?.tab || "LIST", {
          type: "list",
          title: currentTextComponent(currentManifest, 1, "list")?.title || "List",
          items,
        });
      }
    }

    match = input.match(/(?:列表标题|清单标题|步骤标题)\s*(?:改成|改为|写成|是|:|：)\s*(.+)$/);
    if (match) {
      const list = currentTextComponent(currentManifest, 1, "list") || {};
      return pageComponentPatch(currentManifest, Math.min(1, currentManifest.pages.length - 1), currentManifest.pages[1]?.tab || "LIST", {
        type: "list",
        title: match[1].trim(),
        items: list.items || ["Item"],
      });
    }

    if (/告警|警告|异常|风险|错误|失败|报警|warn|error/i.test(input)) return templates.find((template) => template.id === "health-alert")?.manifest || null;
    if (/网络|联网|IP|ip|ssh|frp/i.test(input)) return templates.find((template) => template.id === "network-panel")?.manifest || null;
    if (/AI|ai|任务|助手|agent/i.test(input)) return templates.find((template) => template.id === "ai-task-board")?.manifest || null;
    if (/系统|状态|健康|内存|磁盘/.test(input)) return templates.find((template) => template.id === "device-status")?.manifest || null;

    match = input.match(/(?:指标|显示)\s*(?:改成|改为|写成|写|:|：)?\s*(.+)$/);
    if (match) {
      const metrics = splitGroupedIntentItems(match[1], 3);
      if (metrics.length > 0) {
        return firstPageComponentPatch(currentManifest, {
          type: "metricGroup",
          items: metrics.map(metricItemFromText),
        });
      }
    }

    match = input.match(/(?:系统页|系统)\s*(?:写|显示|:|：)\s*(.+)$/);
    if (match) return linePagePatch(currentManifest, Math.min(1, currentManifest.pages.length - 1), "System", splitIntentItems(match[1]), "SYS");
    match = input.match(/(?:AI页|AI|ai)\s*(?:写|显示|:|：)\s*(.+)$/);
    if (match) return linePagePatch(currentManifest, Math.min(1, currentManifest.pages.length - 1), "AI Agent", splitIntentItems(match[1]), "AI");
    match = input.match(/(?:网络页|网络)\s*(?:写|显示|:|：)\s*(.+)$/);
    if (match) return linePagePatch(currentManifest, Math.min(1, currentManifest.pages.length - 1), "Network", splitIntentItems(match[1]), "NET");

    return null;
  }

  async function handleTemplate(req) {
    let body;
    try {
      body = await readJsonRequest(req);
    } catch (error) {
      return json({ ok: false, error: error.message }, 400);
    }

    const current = await currentManifestForWrite(body);
    if (current.error) return current.error;

    const templateId = String(body.templateId || "");
    const template = templates.find((item) => item.id === templateId);
    if (!template) return json({ ok: false, error: "invalid templateId", summary: "未知的小屏模板。" }, 400);

    try {
      const next = applyMutableManifest(current.manifest, template.manifest);
      const envelope = await writeScreenManifest(next);
      return json({ ok: true, summary: "已更新预览。", template: screenTemplateSummary(template), ...envelope });
    } catch (error) {
      return json({ ok: false, error: "screen manifest update failed", summary: "无法更新小屏预览。", output: error.message }, 500);
    }
  }

  async function handleIntent(req) {
    let body;
    try {
      body = await readJsonRequest(req);
    } catch (error) {
      return json({ ok: false, error: error.message }, 400);
    }

    const current = await currentManifestForWrite(body);
    if (current.error) return current.error;

    const text = String(body.text || "").trim();
    const aiCandidate = looksLikeScreenProgramRequest(text)
      ? await buildAiScreenManifestCandidate(text, current.manifest)
      : null;
    if (aiCandidate?.manifest) {
      try {
        const envelope = await writeScreenManifest(aiCandidate.manifest);
        return json({
          ok: true,
          summary: aiCandidate.patch?.intentSummary || screenProgramIntentSummary(screenProgramSubject(text)),
          generation: aiCandidate.generation,
          ...envelope,
        });
      } catch (error) {
        aiCandidate.generation = {
          ...(aiCandidate.generation || {}),
          source: "ai-fallback",
          fallbackSource: "rule",
          fallbackReason: error.message,
        };
      }
    }

    const patch = parseScreenIntent(text, current.manifest);
    if (!patch) {
      return json({
        ok: false,
        error: "unrecognized screen intent",
        summary: "无法理解这次修改。",
        generation: aiCandidate?.generation || {
          schema: "walnutpi.screenGeneration.v1",
          source: "rule",
          apiUsed: false,
          model: null,
        },
      }, 400);
    }

    try {
      const next = applyMutableManifest(current.manifest, patch);
      const envelope = await writeScreenManifest(next);
      return json({
        ok: true,
        summary: patch.intentSummary || "已更新预览。",
        generation: aiCandidate?.generation || {
          schema: "walnutpi.screenGeneration.v1",
          source: "rule",
          apiUsed: false,
          model: null,
        },
        ...envelope,
      });
    } catch (error) {
      return json({
        ok: false,
        error: "screen manifest update failed",
        summary: "无法更新小屏预览。",
        output: error.message,
        generation: aiCandidate?.generation || {
          schema: "walnutpi.screenGeneration.v1",
          source: "rule",
          apiUsed: false,
          model: null,
        },
      }, 500);
    }
  }

  return {
    applyMutableManifest,
    currentManifestForWrite,
    parseScreenIntent,
    templateSummaries: () => templates.map(screenTemplateSummary),
    writeScreenManifest,
    handleTemplate,
    handleIntent,
  };
}
