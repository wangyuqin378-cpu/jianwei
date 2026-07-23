export function createReviewAutosaveController({
  getModel,
  setModel,
  requestSave,
  onStateChange = () => {},
  debounceMs = 700,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout
}) {
  if (typeof getModel !== "function" || typeof setModel !== "function" || typeof requestSave !== "function") {
    throw new TypeError("Autosave controller requires model accessors and a save request");
  }

  let dirty = false;
  let editVersion = 0;
  let timer = null;
  let inFlight = null;
  let conflict = null;
  let lastError = null;
  let disposed = false;

  const state = () => ({
    dirty,
    editVersion,
    saving: Boolean(inFlight),
    conflict,
    lastError
  });

  const emit = (event, extra = {}) => {
    onStateChange(state(), { event, ...extra });
  };

  const clearScheduledSave = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const scheduleSave = () => {
    clearScheduledSave();
    if (disposed || conflict || !dirty) return;
    timer = setTimer(() => {
      timer = null;
      void save().catch(() => {});
    }, debounceMs);
  };

  const markConflict = (error) => {
    clearScheduledSave();
    conflict = {
      status: Number(error?.status ?? 409),
      message: error?.message || "服务端版本已变化"
    };
    lastError = error instanceof Error ? error : new Error(conflict.message);
    dirty = true;
    emit("conflict");
  };

  async function save({ announce = false } = {}) {
    clearScheduledSave();
    const model = getModel();
    if (disposed || model?.finalized || conflict || !dirty) return state();
    if (inFlight) {
      await inFlight;
      return state();
    }

    const capturedVersion = editVersion;
    const requestModel = {
      ...model,
      decisions: cloneDecisions(model.decisions)
    };
    const operation = (async () => {
      try {
        const serverState = await requestSave(requestModel);
        const currentModel = getModel();
        if (!currentModel) throw new Error("审核页面状态已丢失");
        setModel({
          ...serverState,
          decisions: currentModel.decisions
        });
        dirty = editVersion !== capturedVersion;
        lastError = null;
        emit("saved", { announce });
        if (dirty) scheduleSave();
      } catch (error) {
        dirty = true;
        if (Number(error?.status) === 409) {
          markConflict(error);
        } else {
          lastError = error instanceof Error ? error : new Error("保存失败");
          emit("error", { announce });
        }
        throw error;
      } finally {
        inFlight = null;
        emit("settled", { announce });
      }
      return state();
    })();
    inFlight = operation;
    emit("saving", { announce });
    return operation;
  }

  async function flush() {
    clearScheduledSave();
    while (!disposed && !conflict && (dirty || inFlight)) {
      if (inFlight) {
        try {
          await inFlight;
        } catch {
          return false;
        }
      } else {
        try {
          await save({ announce: true });
        } catch {
          return false;
        }
      }
      clearScheduledSave();
    }
    return !disposed && !conflict && !dirty && !inFlight;
  }

  function changed() {
    if (disposed || getModel()?.finalized) return;
    editVersion += 1;
    dirty = true;
    emit("changed");
    if (!conflict) scheduleSave();
  }

  function dispose() {
    disposed = true;
    clearScheduledSave();
  }

  return {
    changed,
    save,
    flush,
    markConflict,
    getState: state,
    dispose
  };
}

function cloneDecisions(decisions) {
  if (!Array.isArray(decisions)) throw new Error("审核决定列表无效");
  return decisions.map((decision) => ({
    ...decision,
    checkedSourceIds: [...decision.checkedSourceIds]
  }));
}

function startReviewWorkbenchClient() {
  let model = null;
  let autosave = null;
  let finalizing = false;
  const byId = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const setStatus = (message, tone = "normal") => {
    const status = byId("status");
    status.textContent = message;
    status.dataset.tone = tone;
  };

  async function load() {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("无法读取审核会话");
    model = await response.json();
    autosave?.dispose();
    autosave = createReviewAutosaveController({
      getModel: () => model,
      setModel: (value) => {
        model = value;
      },
      requestSave: saveRequest,
      onStateChange
    });
    render();
  }

  async function saveRequest(snapshot) {
    const response = await fetch("/api/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        csrfToken: snapshot.csrfToken,
        revisionSha256: snapshot.revisionSha256,
        decisions: snapshot.decisions
      })
    });
    const value = await response.json();
    if (!response.ok) {
      const error = new Error(value.error || "保存失败");
      error.status = response.status;
      throw error;
    }
    return value;
  }

  function onStateChange(state, detail) {
    updateProgress(state);
    updateControls(state);
    if (model?.finalized) return;
    if (detail.event === "changed") setStatus("有未保存的修改。");
    if (detail.event === "saving") setStatus("正在保存到本机不可变修订记录…");
    if (detail.event === "saved") {
      setStatus(state.dirty ? "刚才的版本已保存，正在等待保存新修改…" : "修订已安全保存到本机。");
    }
    if (detail.event === "conflict") {
      setStatus("检测到版本冲突，本页输入仍完整保留。请确认没有其他窗口正在审核，再选择重新加载服务端版本。", "danger");
    }
    if (detail.event === "error") {
      setStatus(`保存失败，本页输入仍保留：${state.lastError?.message || "请稍后重试"}`, "danger");
    }
  }

  function render() {
    byId("meta").textContent = `目录 ${model.catalogVersion} → ${model.nextCatalogVersion} · 审核人 ${model.reviewerId} · 输出 ${model.outputFileName}`;
    const root = byId("facts");
    root.replaceChildren();
    model.items.forEach((item, index) => root.appendChild(renderFact(item, model.decisions[index])));
    if (model.finalized) {
      setStatus("批次已完成；尚未应用到知识目录。");
      byId("command").textContent = model.applyCommand || "";
      byId("command").hidden = false;
    }
    updateProgress(autosave?.getState());
    updateControls(autosave?.getState());
  }

  function renderFact(item, decision) {
    const card = el("article", "fact");
    const head = el("div", "fact-head");
    const left = el("div");
    left.append(el("div", "topic", `${item.topicName} · ${item.factId}`));
    head.append(left, el("span", `risk ${item.riskLevel}`, item.riskLevel));
    card.append(head, el("p", "fact-text", item.factText));

    const sources = el("div", "sources");
    item.sources.forEach((source) => {
      const row = el("div", "source");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = decision.checkedSourceIds.includes(source.sourceId);
      check.disabled = model.finalized;
      check.setAttribute("aria-label", `确认已人工核对 ${source.title}`);
      check.addEventListener("change", () => {
        const checked = new Set(decision.checkedSourceIds);
        check.checked ? checked.add(source.sourceId) : checked.delete(source.sourceId);
        decision.checkedSourceIds = [...checked];
        autosave.changed();
      });
      const body = el("div");
      const link = el("a", null, source.title);
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      body.append(
        link,
        el("small", null, `${source.publisher} / ${source.authority} / ${source.reachable === true ? "可访问" : source.reachable === false ? "不可访问" : "未验证"}`)
      );
      row.append(check, body);
      sources.append(row);
    });
    card.append(sources);

    const grid = el("div", "review-grid");
    const decisionLabel = el("label");
    decisionLabel.append(el("span", null, "决定"));
    const select = document.createElement("select");
    [["pending", "待决定"], ["approve", "批准"], ["reject", "拒绝"]].forEach(([value, text]) => {
      const option = el("option", null, text);
      option.value = value;
      option.selected = decision.decision === value;
      select.append(option);
    });
    select.disabled = model.finalized;
    select.addEventListener("change", () => {
      decision.decision = select.value;
      autosave.changed();
    });
    decisionLabel.append(select);
    grid.append(decisionLabel);
    grid.append(checkLabel("来源直接支持完整表述", decision.semanticSupportConfirmed, model.finalized, (value) => {
      decision.semanticSupportConfirmed = value;
      autosave.changed();
    }));
    grid.append(checkLabel("已检查数字、因果、范围与不支持结论", decision.unsupportedClaimsChecked, model.finalized, (value) => {
      decision.unsupportedClaimsChecked = value;
      autosave.changed();
    }));

    const notesLabel = el("label", "wide");
    notesLabel.append(el("span", null, "审核记录（拒绝时至少 10 个字符）"));
    const notes = document.createElement("textarea");
    notes.value = decision.notes;
    notes.maxLength = 500;
    notes.disabled = model.finalized;
    notes.addEventListener("input", () => {
      decision.notes = notes.value;
      autosave.changed();
    });
    notesLabel.append(notes);
    grid.append(notesLabel);
    card.append(grid);
    return card;
  }

  function checkLabel(text, checked, disabled, onChange) {
    const label = el("label", "check");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.disabled = disabled;
    input.addEventListener("change", () => onChange(input.checked));
    label.append(input, el("span", null, text));
    return label;
  }

  function updateProgress(state = {}) {
    if (!model) return;
    const done = model.decisions.filter((item) => item.decision !== "pending").length;
    const suffix = state.conflict ? " · 冲突待处理" : state.saving ? " · 保存中" : state.dirty ? " · 未保存" : " · 已保存";
    byId("progress").textContent = `已决定 ${done} / ${model.decisions.length} · 修订 ${model.revision}${suffix}`;
  }

  function updateControls(state = {}) {
    const blocked = Boolean(model?.finalized || finalizing || state.saving || state.conflict);
    byId("save").disabled = blocked || !state.dirty;
    byId("finalize").disabled = blocked;
    byId("reload").hidden = !state.conflict;
  }

  async function saveNow() {
    try {
      await autosave.save({ announce: true });
    } catch {
      // Controller keeps the local decisions and reports the actionable state.
    }
  }

  async function finalize() {
    if (!byId("checkpoint").checked) {
      setStatus("请先完成真人审核确认。", "danger");
      return;
    }
    if (!confirm("完成后会写出批次，但仍需在终端人工应用。继续吗？")) return;
    const clean = await autosave.flush();
    if (!clean) {
      setStatus("尚有未安全保存的修改，已停止完成批次。请先处理保存问题。", "danger");
      return;
    }

    finalizing = true;
    updateControls(autosave.getState());
    setStatus("正在锁定本批次…");
    try {
      const response = await fetch("/api/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          csrfToken: model.csrfToken,
          revisionSha256: model.revisionSha256,
          decisions: model.decisions,
          humanCheckpoint: true
        })
      });
      const value = await response.json();
      if (!response.ok) {
        const error = new Error(value.error || "完成失败");
        error.status = response.status;
        if (response.status === 409) autosave.markConflict(error);
        else setStatus(`完成失败：${error.message}`, "danger");
        return;
      }
      model = value;
      render();
      byId("command").textContent = value.applyCommand;
      byId("command").hidden = false;
      setStatus(value.message);
    } catch (error) {
      setStatus(`完成失败，本页输入仍保留：${error?.message || "请稍后重试"}`, "danger");
    } finally {
      finalizing = false;
      updateControls(autosave.getState());
    }
  }

  byId("save").addEventListener("click", saveNow);
  byId("finalize").addEventListener("click", finalize);
  byId("reload").addEventListener("click", () => {
    if (confirm("重新加载会丢弃本页尚未保存的输入。确定继续吗？")) location.reload();
  });
  addEventListener("beforeunload", (event) => {
    const state = autosave?.getState();
    if (state?.dirty || state?.saving) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  load().catch((error) => setStatus(error.message, "danger"));
}

if (typeof document !== "undefined") startReviewWorkbenchClient();
