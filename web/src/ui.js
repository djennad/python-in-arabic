// عارض الواجهات: يحوّل عمليات مكتبة «واجهات» (afaa/lib/واجهات.af) إلى عناصر
// في الصفحة، ويعيد أحداث المستخدم إلى البرنامج.
//
// العمليات: reset | create | set | remove | clear | draw | page | toast | timer | cancel-timer

const SAFE_URL = /^(https?:|mailto:|data:image\/)/i;

function safeUrl(value) {
  const url = String(value ?? "").trim();
  return SAFE_URL.test(url) ? url : "";
}

function px(value) {
  return typeof value === "number" ? `${value}px` : value;
}

export class UiRenderer {
  // options: sendEvent(id, name, data, mode), onTitle(text), onToast(text, kind), onCreate()
  constructor(root, options) {
    this.root = root;
    this.options = options;
    this.entries = new Map();
    this.timers = new Map();
  }

  get empty() {
    return this.entries.size === 0;
  }

  reset() {
    this.stopAllTimers();
    this.entries.clear();
    this.root.textContent = "";
  }

  apply(ops) {
    for (const op of ops) {
      try {
        this.applyOne(op);
      } catch (err) {
        console.error("واجهات: تعذّر تطبيق العملية", op, err);
      }
    }
  }

  applyOne(op) {
    switch (op.op) {
      case "reset": this.reset(); break;
      case "create": this.create(op); break;
      case "set": this.update(this.entries.get(op.id), op.props); break;
      case "remove": this.remove(op.id); break;
      case "clear": this.clear(op.id); break;
      case "draw": this.draw(this.entries.get(op.id), op.cmds); break;
      case "page": if (op.props.title != null) this.options.onTitle?.(op.props.title); break;
      case "toast": this.options.onToast?.(op.text, op.kind); break;
      case "timer": this.startTimer(op); break;
      case "cancel-timer": this.stopTimer(op.id); break;
    }
  }

  send(id, name, data, mode) {
    this.options.sendEvent(id, name, data, mode);
  }

  // -------------------------------------------------------------------------
  // الإنشاء
  // -------------------------------------------------------------------------
  create({ id, kind, parent, props }) {
    const entry = { id, kind, props: {}, el: null, content: null, control: null };
    const build = this.builders[kind] || this.builders.label;
    build.call(this, entry, props);
    entry.el.dataset.uiId = id;
    entry.el.classList.add("ui-el");
    this.entries.set(id, entry);
    const container = parent == null ? this.root : this.entries.get(parent)?.content;
    (container || this.root).appendChild(entry.el);
    this.update(entry, props);
    this.options.onCreate?.();
  }

  get builders() {
    return {
      heading(entry, props) {
        entry.el = document.createElement(`h${Math.min(Math.max(props.level || 2, 1), 4)}`);
        entry.el.className = "ui-heading";
      },
      label(entry) {
        entry.el = document.createElement("p");
        entry.el.className = "ui-label";
      },
      link(entry) {
        entry.el = document.createElement("a");
        entry.el.className = "ui-link";
        entry.el.target = "_blank";
        entry.el.rel = "noopener noreferrer";
      },
      image(entry) {
        entry.el = document.createElement("img");
        entry.el.className = "ui-image";
        entry.el.loading = "lazy";
      },
      divider(entry) {
        entry.el = document.createElement("hr");
        entry.el.className = "ui-divider";
      },
      progress(entry) {
        entry.el = document.createElement("progress");
        entry.el.className = "ui-progress";
      },
      table(entry) {
        entry.el = document.createElement("div");
        entry.el.className = "ui-table-wrap";
        entry.control = document.createElement("table");
        entry.control.className = "ui-table";
        entry.el.appendChild(entry.control);
      },
      button(entry) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ui-button";
        button.addEventListener("click", () => this.send(entry.id, "click"));
        entry.el = entry.control = button;
      },
      textinput(entry) {
        const input = document.createElement("input");
        input.className = "ui-input";
        input.dir = "auto";
        input.addEventListener("input", () => this.send(entry.id, "change", input.value, "latest"));
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && !event.isComposing) this.send(entry.id, "submit", input.value);
        });
        entry.el = entry.control = input;
      },
      textarea(entry) {
        const area = document.createElement("textarea");
        area.className = "ui-input ui-textarea";
        area.dir = "auto";
        area.addEventListener("input", () => this.send(entry.id, "change", area.value, "latest"));
        entry.el = entry.control = area;
      },
      number(entry) {
        const input = document.createElement("input");
        input.type = "number";
        input.className = "ui-input ui-number";
        input.addEventListener("input", () => this.send(entry.id, "change", input.value, "latest"));
        entry.el = entry.control = input;
      },
      slider(entry) {
        const wrap = document.createElement("label");
        wrap.className = "ui-slider";
        const input = document.createElement("input");
        input.type = "range";
        const value = document.createElement("output");
        input.addEventListener("input", () => {
          value.textContent = input.value;
          this.send(entry.id, "change", input.value, "latest");
        });
        wrap.append(input, value);
        entry.el = wrap;
        entry.control = input;
        entry.valueLabel = value;
      },
      checkbox(entry) {
        const wrap = document.createElement("label");
        wrap.className = "ui-checkbox";
        const input = document.createElement("input");
        input.type = "checkbox";
        const text = document.createElement("span");
        input.addEventListener("change", () => this.send(entry.id, "change", input.checked));
        wrap.append(input, text);
        entry.el = wrap;
        entry.control = input;
        entry.textEl = text;
      },
      select(entry) {
        const select = document.createElement("select");
        select.className = "ui-select";
        select.addEventListener("change", () => this.send(entry.id, "change", select.value));
        entry.el = entry.control = select;
      },
      canvas(entry, props) {
        const canvas = document.createElement("canvas");
        canvas.className = "ui-canvas";
        const ratio = Math.min(window.devicePixelRatio || 1, 3);
        const width = props.width || 400;
        const height = props.height || 300;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.aspectRatio = `${width} / ${height}`;
        canvas.style.width = `min(100%, ${width}px)`;
        const ctx = canvas.getContext("2d");
        ctx.scale(ratio, ratio);
        Object.assign(entry, { el: canvas, ctx, width, height, background: props.background });
        this.fillBackground(entry);
        canvas.addEventListener("click", (event) => {
          const rect = canvas.getBoundingClientRect();
          const x = Math.round(((event.clientX - rect.left) / rect.width) * width);
          const y = Math.round(((event.clientY - rect.top) / rect.height) * height);
          this.send(entry.id, "click", { x, y });
        });
      },
      row(entry) {
        entry.el = entry.content = document.createElement("div");
        entry.el.className = "ui-row";
      },
      column(entry) {
        entry.el = entry.content = document.createElement("div");
        entry.el.className = "ui-column";
      },
      grid(entry) {
        entry.el = entry.content = document.createElement("div");
        entry.el.className = "ui-grid";
      },
      card(entry) {
        entry.el = document.createElement("section");
        entry.el.className = "ui-card";
        entry.titleEl = document.createElement("h3");
        entry.titleEl.className = "ui-card-title";
        entry.titleEl.hidden = true;
        entry.content = document.createElement("div");
        entry.content.className = "ui-card-body";
        entry.el.append(entry.titleEl, entry.content);
      },
    };
  }

  // -------------------------------------------------------------------------
  // التحديث
  // -------------------------------------------------------------------------
  update(entry, props) {
    if (!entry || !props) return;
    Object.assign(entry.props, props);
    const { el, control } = entry;
    // الحدود والخيارات قبل القيمة، وإلا قصّ المتصفح القيمة إلى الحدود الافتراضية
    const first = new Set(["min", "max", "step", "options"]);
    const keys = Object.keys(props).sort((a, b) => first.has(b) - first.has(a));
    for (const key of keys) {
      const value = props[key];
      switch (key) {
        case "text":
          if (entry.kind === "checkbox") entry.textEl.textContent = value;
          else if (entry.kind === "card") this.update(entry, { title: value });
          else el.textContent = value ?? "";
          break;
        case "title":
          entry.titleEl.textContent = value ?? "";
          entry.titleEl.hidden = !value;
          break;
        case "value":
          if (entry.kind === "checkbox") control.checked = Boolean(value);
          else if (entry.kind === "progress") el.value = Number(value) || 0;
          else if (control && control.value !== String(value ?? "")) control.value = value ?? "";
          if (entry.valueLabel) entry.valueLabel.textContent = control.value;
          break;
        case "placeholder": control.placeholder = value ?? ""; break;
        case "password": control.type = value ? "password" : "text"; break;
        case "rows":
          if (entry.kind === "table") this.renderTable(entry);
          else control.rows = value;
          break;
        case "columns":
          if (entry.kind === "table") this.renderTable(entry);
          else el.style.gridTemplateColumns = `repeat(${Math.max(1, value | 0)}, minmax(0, 1fr))`;
          break;
        case "min": case "max": case "step":
          if (entry.kind === "progress") { if (key === "max") el.max = Number(value) || 100; }
          else if (value != null) control[key] = value;
          else control.removeAttribute(key);
          break;
        case "options":
          control.textContent = "";
          for (const option of value || []) control.add(new Option(option, option));
          if (entry.props.value != null) control.value = entry.props.value;
          break;
        case "variant": el.dataset.variant = value; break;
        case "href": el.href = safeUrl(value) || "#"; break;
        case "src": el.src = safeUrl(value); break;
        case "alt": el.alt = value ?? ""; break;
        case "width": if (entry.kind === "image" && value) el.style.width = px(value); break;
        case "gap": if (value != null) el.style.gap = px(value); break;
        case "visible": el.hidden = value === false; break;
        case "disabled":
          (control || el).disabled = Boolean(value);
          el.classList.toggle("ui-disabled", Boolean(value));
          break;
        case "style": this.applyStyle(el, value || {}); break;
      }
    }
  }

  applyStyle(el, style) {
    const s = el.style;
    s.color = style.color || "";
    s.background = style.background || "";
    s.fontSize = style.fontSize ? px(style.fontSize) : "";
    s.fontWeight = style.bold ? "700" : "";
    s.textAlign = style.align || "";
    s.width = style.width != null ? px(style.width) : "";
    s.height = style.height != null ? px(style.height) : "";
    s.padding = style.padding != null ? px(style.padding) : "";
  }

  renderTable(entry) {
    const { columns = [], rows = [] } = entry.props;
    const table = entry.control;
    table.textContent = "";
    const head = table.createTHead().insertRow();
    for (const column of columns) {
      const th = document.createElement("th");
      th.textContent = column;
      head.appendChild(th);
    }
    const body = table.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      for (const cell of row) tr.insertCell().textContent = cell;
    }
  }

  // -------------------------------------------------------------------------
  // الحذف
  // -------------------------------------------------------------------------
  forget(el) {
    for (const node of [el, ...el.querySelectorAll("[data-ui-id]")]) {
      this.entries.delete(Number(node.dataset.uiId));
    }
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.forget(entry.el);
    entry.el.remove();
  }

  clear(id) {
    const container = id == null ? this.root : this.entries.get(id)?.content;
    if (!container) return;
    for (const child of [...container.children]) {
      this.forget(child);
      child.remove();
    }
  }

  // -------------------------------------------------------------------------
  // الرسم
  // -------------------------------------------------------------------------
  fillBackground(entry) {
    const { ctx, width, height, background } = entry;
    ctx.clearRect(0, 0, width, height);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
  }

  draw(entry, commands) {
    if (!entry || !entry.ctx) return;
    const ctx = entry.ctx;
    const finish = (color, fill, width) => {
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (color && width > 0) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
      }
    };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [type, ...a] of commands) {
      switch (type) {
        case "clear":
          this.fillBackground(entry);
          break;
        case "line":
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(a[2], a[3]);
          finish(a[4], null, a[5]);
          break;
        case "rect":
          ctx.beginPath();
          ctx.rect(a[0], a[1], a[2], a[3]);
          finish(a[4], a[5], a[6]);
          break;
        case "circle":
          ctx.beginPath();
          ctx.arc(a[0], a[1], Math.max(0, a[2]), 0, Math.PI * 2);
          finish(a[3], a[4], a[5]);
          break;
        case "poly":
          ctx.beginPath();
          (a[0] || []).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.closePath();
          finish(a[1], a[2], a[3]);
          break;
        case "text":
          ctx.font = `${a[4] || 16}px "IBM Plex Sans Arabic", system-ui, sans-serif`;
          ctx.fillStyle = a[3] || "#111827";
          ctx.textAlign = a[5] || "center";
          ctx.textBaseline = "middle";
          ctx.direction = "rtl";
          ctx.fillText(a[0], a[1], a[2]);
          break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // المؤقتات
  // -------------------------------------------------------------------------
  startTimer({ id, ms, repeat }) {
    this.stopTimer(id);
    const tick = () => {
      if (!repeat) this.timers.delete(id);
      this.send(id, "tick", null, "drop");
    };
    this.timers.set(id, repeat ? setInterval(tick, ms) : setTimeout(tick, ms));
  }

  stopTimer(id) {
    const timer = this.timers.get(id);
    clearTimeout(timer);
    clearInterval(timer);
    this.timers.delete(id);
  }

  stopAllTimers() {
    for (const id of [...this.timers.keys()]) this.stopTimer(id);
  }
}
