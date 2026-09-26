import { STATUS_IDS } from "./shared.mjs";
function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
        .ark-gacha-launcher {
            position: fixed; right: 25px; bottom: 85px; z-index: 9999;
            width: 56px; height: 56px; border: 0; border-radius: 50%;
            color: #fff; background: linear-gradient(135deg, #f09199, #f2a2a9);
            box-shadow: 0 5px 18px rgba(240, 145, 153, .48); cursor: pointer;
            font-size: 28px; line-height: 1; transition: .3s cubic-bezier(.175,.885,.32,1.275);
        }
        .ark-gacha-launcher:hover { transform: translateY(-5px) scale(1.08) rotate(9deg); }
        .ark-gacha-mask {
            position: fixed; inset: 0; z-index: 10000; display: none;
            align-items: center; justify-content: center; padding: 14px;
            background: rgba(0, 0, 0, .74); backdrop-filter: blur(8px);
        }
        .ark-gacha-modal {
            width: 95%; max-width: 800px; max-height: 86vh; overflow-y: auto;
            box-sizing: border-box; padding: 24px; border-radius: 24px;
            background: #fff; color: #333; box-shadow: 0 12px 48px rgba(0,0,0,.24);
            animation: ark-gacha-modal-in .3s ease-out; scrollbar-width: none;
        }
        .ark-gacha-modal::-webkit-scrollbar { display: none; }
        [data-theme='dark'] .ark-gacha-modal, body[data-theme='dark'] .ark-gacha-modal {
            background: #2d2e2f; color: #eee;
        }
        @keyframes ark-gacha-modal-in {
            from { opacity: 0; transform: scale(.95); }
            to { opacity: 1; transform: scale(1); }
        }
        .ark-gacha-tabs {
            display: flex; gap: 4px; margin-bottom: 20px; overflow-x: auto;
            flex-shrink: 0; border-bottom: 2px solid #f1f1f1; scrollbar-width: none;
        }
        [data-theme='dark'] .ark-gacha-tabs, body[data-theme='dark'] .ark-gacha-tabs { border-color: #444; }
        .ark-gacha-tabs::-webkit-scrollbar { display: none; }
        .ark-gacha-tab {
            flex: 0 0 auto; margin: 0; padding: 8px 16px; border: 0; border-bottom: 3px solid transparent;
            border-radius: 0; appearance: none; background: transparent; box-shadow: none;
            color: #888; cursor: pointer; font: inherit; font-size: 14px; line-height: normal;
            white-space: nowrap; transition: .2s;
        }
        .ark-gacha-tab:hover, .ark-gacha-tab.active { color: #f09199; }
        .ark-gacha-tab.active { border-bottom-color: #f09199; font-weight: 700; }
        .ark-gacha-result-grid {
            display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;
            width: 100%; box-sizing: border-box; padding: 4px; align-content: start; align-items: start;
        }
        .ark-gacha-result-grid.ten-gacha {
            grid-template-columns: repeat(5, minmax(0, 1fr)); grid-template-rows: repeat(2, auto);
        }
        .ark-gacha-message {
            grid-column: 1 / -1; display: flex; align-items: center; justify-content: center;
            box-sizing: border-box; min-height: 300px; padding: 40px 0; color: #aaa; font-size: 14px; text-align: center;
        }
        .ark-gacha-card {
            position: relative; display: flex; flex-direction: column; overflow: hidden;
            min-width: 0; border: 1px solid #eee; border-radius: 10px; background: #fff;
            box-shadow: 0 2px 8px rgba(0,0,0,.04); cursor: pointer; opacity: 0;
            transform: translateY(20px); transition: .3s;
        }
        .ark-gacha-card.card-enter { opacity: 1; transform: translateY(0); }
        .ark-gacha-card:hover { transform: translateY(-6px); border-color: #f09199; box-shadow: 0 12px 28px rgba(240,145,153,.25); }
        [data-theme='dark'] .ark-gacha-card, body[data-theme='dark'] .ark-gacha-card { background: #3a3a3a; border-color: #444; }
        .ark-gacha-cover-box {
            position: relative; display: flex; align-items: center; justify-content: center;
            width: 100%; aspect-ratio: 2 / 2.8; overflow: hidden; background: #f5f5f5;
            border-bottom: 2px solid #f09199;
        }
        [data-theme='dark'] .ark-gacha-cover-box, body[data-theme='dark'] .ark-gacha-cover-box { background: #444; }
        .ark-gacha-cover-img { display: block; width: 100%; height: 100%; object-fit: cover; }
        .ark-gacha-cover-placeholder { color: #aaa; font-size: 24px; }
        .ark-gacha-title {
            position: relative; z-index: 2; display: flex; align-items: center; justify-content: center;
            box-sizing: border-box; min-height: calc(2.4em + 12px); height: var(--ark-gacha-title-height, auto); padding: 6px 4px;
            color: #fff; font-size: 12px; font-weight: 700; line-height: 1.2;
            text-align: center; text-shadow: 0 1px 2px rgba(0,0,0,.55);
            overflow: hidden; overflow-wrap: anywhere; word-break: break-word;
        }
        .ark-gacha-title.title-bg-0star { background: linear-gradient(135deg, #121200, #000); }
        .ark-gacha-title.title-bg-6star { background: linear-gradient(135deg, #ff9c00, #e68a00); }
        .ark-gacha-title.title-bg-5star { background: linear-gradient(135deg, #ffd700, #e6c300); }
        .ark-gacha-title.title-bg-4star { background: linear-gradient(135deg, #9623ff, #851ae6); }
        .ark-gacha-title.title-bg-3star { background: linear-gradient(135deg, #4d88ff, #3a75e6); }
        .ark-gacha-title.title-bg-2star { background: linear-gradient(135deg, #b0c4de, #9fb6cd); }
        .ark-gacha-title.title-bg-1star { background: linear-gradient(135deg, #7f7f7f, #6e6e6e); }
        .ark-gacha-score { padding: 4px; color: #444; font-size: 11px; font-weight: 700; text-align: center; }
        .ark-gacha-score.score-bg-0star { background: rgba(0, 0, 0, .14); }
        .ark-gacha-score.score-bg-1star { background: rgba(127, 127, 127, .14); }
        .ark-gacha-score.score-bg-2star { background: rgba(176, 196, 222, .14); }
        .ark-gacha-score.score-bg-3star { background: rgba(77, 136, 255, .14); }
        .ark-gacha-score.score-bg-4star { background: rgba(150, 35, 255, .14); }
        .ark-gacha-score.score-bg-5star { background: rgba(255, 215, 0, .14); }
        .ark-gacha-score.score-bg-6star { background: rgba(255, 156, 0, .14); }
        [data-theme='dark'] .ark-gacha-score, body[data-theme='dark'] .ark-gacha-score { color: #ddd; }
        .ark-gacha-effect {
            position: absolute; inset: 0; z-index: 1; pointer-events: none; opacity: 0;
            animation: ark-gacha-effect-fade 1.8s ease-out forwards;
        }
        .ark-gacha-effect.effect-0star {
            background: radial-gradient(circle at center, rgba(30,30,30,.82) 0%, rgba(0,0,0,.96) 58%, rgba(0,0,0,1) 100%);
        }
        .ark-gacha-effect.effect-1star {
            background: radial-gradient(circle at center, rgba(127,127,127,.68) 0%, rgba(90,90,90,.88) 58%, rgba(0,0,0,.96) 100%);
        }
        .ark-gacha-effect.effect-2star {
            background: radial-gradient(circle at center, rgba(176,196,222,.68) 0%, rgba(125,145,170,.88) 58%, rgba(0,0,0,.96) 100%);
        }
        .ark-gacha-effect.effect-3star {
            background: radial-gradient(circle at center, rgba(77,136,255,.72) 0%, rgba(48,92,205,.9) 58%, rgba(0,0,0,.96) 100%);
        }
        .ark-gacha-effect.effect-4star {
            background: radial-gradient(circle at center, rgba(150,35,255,.74) 0%, rgba(105,20,190,.92) 58%, rgba(0,0,0,.96) 100%);
        }
        .ark-gacha-effect.effect-5star {
            background: radial-gradient(circle at center, rgba(255,215,0,.76) 0%, rgba(210,160,0,.93) 58%, rgba(0,0,0,.96) 100%);
        }
        .ark-gacha-effect.effect-6star {
            background: radial-gradient(circle at center, rgba(255,156,0,.76) 0%, rgba(215,92,0,.94) 58%, rgba(0,0,0,.96) 100%);
        }
        @keyframes ark-gacha-effect-fade {
            0% { opacity: .72; }
            32% { opacity: 1; }
            100% { opacity: 0; }
        }
        .ark-gacha-footer {
            display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap;
            flex-shrink: 0; gap: 12px; margin-top: 24px;
        }
        .ark-gacha-info-area { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .ark-gacha-pool-box { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
        .ark-gacha-pool-info { color: #bbb; font-size: 11px; letter-spacing: .5px; }
        .ark-gacha-refresh-btn {
            width: auto; min-width: 0; height: auto; margin: 0; padding: 0; border: 0;
            appearance: none; background: transparent; box-shadow: none;
            color: inherit; cursor: pointer; font: inherit; font-size: 12px; line-height: 1;
            opacity: .5; transition: .2s;
        }
        .ark-gacha-refresh-btn:hover { color: #f09199; opacity: 1; transform: rotate(45deg); }
        .ark-gacha-progress { color: #f09199; font-size: 12px; font-weight: 700; }
        .ark-gacha-progress-wrap { display: flex; align-items: center; gap: 8px; }
        .ark-gacha-progress-wrap[hidden] { display: none; }
        .ark-gacha-mini-btn {
            padding: 4px 10px; border: 1px solid #eee; border-radius: 8px;
            background: #fff; color: #999; font-size: 11px; cursor: pointer; transition: .2s;
        }
        [data-theme='dark'] .ark-gacha-mini-btn, body[data-theme='dark'] .ark-gacha-mini-btn { background: #3a3a3a; border-color: #555; color: #ccc; }
        .ark-gacha-mini-btn:hover { border-color: #f09199; color: #f09199; }
        .ark-gacha-logs { display: flex; flex-direction: column; max-width: 430px; max-height: 44px; overflow: hidden; color: #aaa; font-size: 10px; line-height: 1.4; }
        .ark-gacha-log-error { color: #e57373; }
        .ark-gacha-confirm {
            display: flex; align-items: center; justify-content: space-between; gap: 10px;
            margin-top: 12px; padding: 10px 12px; border: 1px solid #f6d4d7; border-radius: 10px;
            background: #fff8f8; color: #a85c63; font-size: 12px;
        }
        .ark-gacha-confirm[hidden] { display: none; }
        [data-theme='dark'] .ark-gacha-confirm, body[data-theme='dark'] .ark-gacha-confirm { background: #422f31; border-color: #654447; color: #f0aeb4; }
        .ark-gacha-confirm-actions { display: flex; flex: 0 0 auto; gap: 6px; }
        .ark-gacha-confirm button { padding: 5px 8px; border: 1px solid #f0b9be; border-radius: 7px; background: transparent; color: inherit; cursor: pointer; font-size: 11px; }
        .ark-gacha-confirm button.primary { background: #f09199; color: #fff; border-color: #f09199; }
        .ark-gacha-btn-group { display: flex; gap: 8px; width: 100%; max-width: 320px; }
        .ark-gacha-main-btn {
            flex: 1; padding: 10px 0; border: 0; border-radius: 50px; color: #fff;
            background: linear-gradient(135deg, #f09199, #f2a2a9); box-shadow: 0 5px 16px rgba(240,145,153,.28);
            cursor: pointer; font-size: 15px; font-weight: 700; transition: .2s;
        }
        .ark-gacha-main-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(240,145,153,.44); }
        .ark-gacha-main-btn:active:not(:disabled) { transform: scale(.96); }
        .ark-gacha-main-btn:disabled { background: #ddd; color: #aaa; box-shadow: none; cursor: wait; }
        @media (max-width: 600px) {
            .ark-gacha-launcher { right: 18px; bottom: 72px; width: 52px; height: 52px; }
            .ark-gacha-modal { width: 96%; max-height: 90vh; padding: 16px; }
            .ark-gacha-result-grid { gap: 8px; }
            .ark-gacha-result-grid.ten-gacha { gap: 6px; }
            .ark-gacha-message { min-height: 230px; padding: 20px 0; }
            .ark-gacha-title { min-height: calc(2.4em + 8px); padding: 4px 2px; font-size: 10px; }
            .ark-gacha-score { padding: 2px; font-size: 9px; }
            .ark-gacha-footer { flex-direction: column; align-items: stretch; margin-top: 16px; }
            .ark-gacha-info-area { align-items: center; text-align: center; }
            .ark-gacha-pool-box { justify-content: center; }
            .ark-gacha-btn-group { width: 100%; max-width: 100%; }
            .ark-gacha-main-btn { flex: 1; padding: 12px 0; }
            .ark-gacha-confirm { align-items: stretch; flex-direction: column; }
            .ark-gacha-confirm-actions button { flex: 1; }
        }
    `;

export class GachaView {
  constructor(session) {
    this.session = session;
    this.logs = [];
    this.titleHeightFrame = null;
    this.renderStyles();
    this.renderLauncher();
    this.renderModal();
    window.addEventListener("resize", () => this.scheduleTitleHeightSync());
  }
  renderStyles() {
    if (document.querySelector("style[data-bangumi-ark-gacha-style]")) return;
    const style = document.createElement("style");
    style.dataset.bangumiArkGachaStyle = "true";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  renderLauncher() {
    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "ark-gacha-launcher";
    launcher.dataset.bangumiArkGacha = "launcher";
    launcher.textContent = "🎲";
    launcher.title = "打开收藏扭蛋机";
    launcher.addEventListener("click", () => {
      this.toggleModal(true);
      this.session.open();
    });
    document.body.appendChild(launcher);
    this.launcher = launcher;
  }

  renderModal() {
    const mask = document.createElement("div");
    mask.className = "ark-gacha-mask";
    mask.dataset.bangumiArkGacha = "modal";
    mask.innerHTML = `
                <div class="ark-gacha-modal" role="dialog" aria-label="收藏扭蛋机">
                    <div class="ark-gacha-tabs">
                        ${["all", ...STATUS_IDS]
                          .map(
                            (status) => `
                            <button type="button" class="ark-gacha-tab ${status === this.session.currentStatus ? "active" : ""}" data-status="${status}">${this.session.statusLabels[status]}</button>
                        `,
                          )
                          .join("")}
                    </div>
                    <div class="ark-gacha-result-grid" id="ark-gacha-result">
                        <div class="ark-gacha-message">打开扭蛋机开始读取收藏</div>
                    </div>
                    <div class="ark-gacha-confirm" id="ark-gacha-confirm" hidden></div>
                    <div class="ark-gacha-footer">
                        <div class="ark-gacha-info-area">
                            <div class="ark-gacha-pool-box">
                                <span class="ark-gacha-pool-info" id="ark-gacha-info">POOL: 0</span>
                                <button type="button" class="ark-gacha-refresh-btn" id="ark-gacha-refresh" title="全量更新当前收藏范围">🔄</button>
                            </div>
                            <div class="ark-gacha-progress-wrap" id="ark-gacha-progress-wrap" hidden>
                                <span class="ark-gacha-progress" id="ark-gacha-progress">准备同步...</span>
                            </div>
                            <div class="ark-gacha-logs" id="ark-gacha-logs"></div>
                        </div>
                        <div class="ark-gacha-btn-group">
                            <button type="button" class="ark-gacha-main-btn" id="ark-gacha-run-3" disabled>🎲 一键三连</button>
                            <button type="button" class="ark-gacha-main-btn" id="ark-gacha-run-10" disabled>✨ 一发十连</button>
                        </div>
                    </div>
                </div>
            `;
    document.body.appendChild(mask);

    this.ui = {
      mask,
      result: mask.querySelector("#ark-gacha-result"),
      info: mask.querySelector("#ark-gacha-info"),
      refresh: mask.querySelector("#ark-gacha-refresh"),
      progressWrap: mask.querySelector("#ark-gacha-progress-wrap"),
      progress: mask.querySelector("#ark-gacha-progress"),
      logs: mask.querySelector("#ark-gacha-logs"),
      confirm: mask.querySelector("#ark-gacha-confirm"),
      run3: mask.querySelector("#ark-gacha-run-3"),
      run10: mask.querySelector("#ark-gacha-run-10"),
    };

    mask.querySelectorAll(".ark-gacha-tab").forEach((tab) => {
      tab.addEventListener("click", () =>
        this.session.selectStatus(tab.dataset.status),
      );
    });
    mask.addEventListener("click", (event) => {
      if (event.target === mask) this.toggleModal(false);
    });
    this.ui.refresh.addEventListener("click", () =>
      this.session.forceRefresh(),
    );
    this.ui.run3.addEventListener("click", () => this.session.draw(3));
    this.ui.run10.addEventListener("click", () => this.session.draw(10));
  }

  toggleModal(open) {
    this.ui.mask.style.display = open ? "flex" : "none";
    if (open) this.scheduleTitleHeightSync();
  }

  setStatus(message, error = false) {
    this.ui.progress.textContent = message;
    this.ui.progress.classList.toggle("ark-gacha-log-error", Boolean(error));
  }

  addLog(message, error = false) {
    this.logs.push({ message: String(message), error });
    if (this.logs.length > 4) this.logs.shift();
    this.ui.logs.replaceChildren(
      ...this.logs.map((entry) => {
        const line = document.createElement("span");
        line.textContent = entry.message;
        if (entry.error) line.className = "ark-gacha-log-error";
        return line;
      }),
    );
  }

  clearLogs() {
    this.logs = [];
    this.ui.logs.replaceChildren();
  }

  hasResultMessage() {
    return (
      Boolean(this.ui.result.querySelector(".ark-gacha-message")) &&
      !this.session.busy
    );
  }

  setResultMessage(message) {
    this.ui.result.style.removeProperty("--ark-gacha-title-height");
    this.ui.result.className = "ark-gacha-result-grid";
    this.ui.result.innerHTML = `<div class="ark-gacha-message">${escapeHtml(message)}</div>`;
  }

  scheduleTitleHeightSync() {
    if (this.titleHeightFrame != null)
      window.cancelAnimationFrame(this.titleHeightFrame);
    this.titleHeightFrame = window.requestAnimationFrame(() => {
      this.titleHeightFrame = null;
      if (this.ui.mask.style.display !== "flex") return;
      const titles = Array.from(
        this.ui.result.querySelectorAll(".ark-gacha-title"),
      );
      if (!titles.length) {
        this.ui.result.style.removeProperty("--ark-gacha-title-height");
        return;
      }

      this.ui.result.style.removeProperty("--ark-gacha-title-height");
      const maxHeight = Math.max(
        ...titles.map((title) => Math.ceil(title.scrollHeight)),
      );
      this.ui.result.style.setProperty(
        "--ark-gacha-title-height",
        `${maxHeight}px`,
      );
    });
  }

  updateInfo(suffix = "") {
    this.ui.info.textContent = `POOL: ${this.session.pool.length}${suffix ? ` ${suffix}` : ""}`;
  }

  updateButtons() {
    const disabled = this.session.busy || !this.session.complete;
    this.ui.run3.disabled = disabled || this.session.pool.length < 3;
    this.ui.run10.disabled = disabled || this.session.pool.length < 10;
    this.ui.refresh.disabled = false;
  }

  setProgressVisible(visible) {
    this.ui.progressWrap.hidden = !visible;
  }

  selectStatus(status) {
    this.ui.mask.querySelectorAll(".ark-gacha-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.status === status);
    });
  }

  setShuffling(shuffling) {
    this.ui.result.classList.toggle("ark-gacha-shuffling", shuffling);
  }

  showPreparingCards(count) {
    this.ui.result.className = `ark-gacha-result-grid${count === 10 ? " ten-gacha" : ""}`;
    this.ui.result.innerHTML =
      '<div class="ark-gacha-message">正在获取选中条目的评分...</div>';
  }

  showCards(cardData, count) {
    this.ui.result.replaceChildren();
    cardData.forEach((data, index) => {
      const card = this.createCard(data);
      this.ui.result.appendChild(card);
      window.setTimeout(
        () => card.classList.add("card-enter"),
        index * (count === 10 ? 120 : 260),
      );
    });
    this.scheduleTitleHeightSync();
    if (document.fonts?.ready)
      document.fonts.ready.then(() => this.scheduleTitleHeightSync());
  }

  hideConfirm() {
    this.ui.confirm.hidden = true;
    this.ui.confirm.replaceChildren();
  }

  showFailure(canUseCache) {
    this.ui.confirm.hidden = false;
    this.ui.confirm.innerHTML = `
                <span>当前范围获取失败，请选择后续操作</span>
                <span class="ark-gacha-confirm-actions">
                    ${canUseCache ? '<button type="button" data-action="keep">继续使用缓存</button>' : ""}
                    <button type="button" class="primary" data-action="refresh">全量更新</button>
                </span>
            `;
    this.ui.confirm
      .querySelector('[data-action="keep"]')
      ?.addEventListener("click", () => this.hideConfirm());
    this.ui.confirm
      .querySelector('[data-action="refresh"]')
      .addEventListener("click", () => {
        this.hideConfirm();
        this.session.forceRefresh();
      });
  }

  createCard(data) {
    const card = document.createElement("div");
    card.className = "ark-gacha-card";
    card.tabIndex = 0;
    card.setAttribute("role", "link");

    const effect = document.createElement("div");
    effect.className = `ark-gacha-effect effect-${data.star}star`;
    const coverBox = document.createElement("div");
    coverBox.className = "ark-gacha-cover-box";
    if (data.cover) {
      const image = document.createElement("img");
      image.className = "ark-gacha-cover-img";
      image.src = data.cover;
      image.alt = data.title;
      image.addEventListener(
        "error",
        () => {
          image.remove();
          const placeholder = document.createElement("span");
          placeholder.className = "ark-gacha-cover-placeholder";
          placeholder.textContent = "✦";
          coverBox.appendChild(placeholder);
        },
        { once: true },
      );
      coverBox.appendChild(image);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "ark-gacha-cover-placeholder";
      placeholder.textContent = "✦";
      coverBox.appendChild(placeholder);
    }

    const title = document.createElement("div");
    title.className = `ark-gacha-title title-bg-${data.star}star`;
    title.textContent = data.title || "无标题条目";
    const score = document.createElement("div");
    score.className = `ark-gacha-score score-bg-${data.star}star`;
    score.textContent = `评分：${data.info.hasScore ? data.info.score : "无"}`;

    card.append(effect, coverBox, title, score);
    const openSubject = () => {
      const opened = window.open(data.link, "_blank", "noopener");
      if (opened) opened.opener = null;
    };
    card.addEventListener("click", openSubject);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openSubject();
      }
    });
    return card;
  }
}
