// عارض الواجهات: يحوّل عمليات مكتبة «واجهات» (afaa/lib/واجهات.af) إلى عناصر
// في الصفحة، ويعيد أحداث المستخدم إلى البرنامج.
//
// العمليات: reset | create | set | remove | clear | draw | page | toast | timer | cancel-timer | keys | download

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
    this.keysId = null;
    this.applyTheme(null);
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
      case "page":
        if (op.props.title != null) this.options.onTitle?.(op.props.title);
        if (op.props.theme) this.applyTheme(op.props.theme);
        break;
      case "download": this.download(op); break;
      case "toast": this.options.onToast?.(op.text, op.kind); break;
      case "timer": this.startTimer(op); break;
      case "cancel-timer": this.stopTimer(op.id); break;
      case "keys": this.listenKeys(op.id); break;
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
    const parentEntry = parent == null ? null : this.entries.get(parent);
    // النوافذ المنبثقة في جذر التطبيق: تظهر حتى لو كانت حاويتها مخفية (مثل لسان آخر)
    const container = kind === "dialog" || !parentEntry ? this.root : parentEntry.content;
    (container || this.root).appendChild(entry.el);
    if (parentEntry?.kind === "tabs") this.addTab(parentEntry, entry);
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
        entry.el.className = "ui-table-box";
        entry.search = document.createElement("input");
        entry.search.type = "search";
        entry.search.className = "ui-input ui-table-search";
        entry.search.placeholder = "🔍 ابحث في الجدول…";
        entry.search.hidden = true;
        entry.search.addEventListener("input", () => {
          entry.view.query = entry.search.value.trim().toLowerCase();
          entry.view.page = 0;
          this.renderTable(entry);
        });
        const wrap = document.createElement("div");
        wrap.className = "ui-table-wrap";
        entry.control = document.createElement("table");
        entry.control.className = "ui-table";
        wrap.appendChild(entry.control);
        entry.pager = document.createElement("div");
        entry.pager.className = "ui-table-pager";
        entry.pager.hidden = true;
        entry.el.append(entry.search, wrap, entry.pager);
        entry.view = { sort: null, desc: false, query: "", page: 0, selected: null };
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
      radio(entry) {
        entry.el = entry.control = document.createElement("div");
        entry.el.className = "ui-radio";
        entry.el.setAttribute("role", "radiogroup");
      },
      switch(entry, props) {
        this.builders.checkbox.call(this, entry, props);
        entry.el.classList.add("ui-switch");
        entry.control.setAttribute("role", "switch");
      },
      date(entry) { this.builders.typedInput.call(this, entry, "date"); },
      time(entry) { this.builders.typedInput.call(this, entry, "time"); },
      color(entry) { this.builders.typedInput.call(this, entry, "color"); },
      typedInput(entry, type) {
        const input = document.createElement("input");
        input.type = type;
        input.className = `ui-input ui-${type}`;
        input.addEventListener(type === "color" ? "input" : "change",
          () => this.send(entry.id, "change", input.value, "latest"));
        entry.el = entry.control = input;
      },
      file(entry) {
        const label = document.createElement("label");
        label.className = "ui-button ui-file";
        label.dataset.variant = "secondary";
        const input = document.createElement("input");
        input.type = "file";
        const text = document.createElement("span");
        input.addEventListener("change", () => this.upload(entry, input));
        label.append(input, text);
        Object.assign(entry, { el: label, control: input, textEl: text });
      },
      tabs(entry) {
        entry.el = document.createElement("div");
        entry.el.className = "ui-tabs";
        entry.bar = document.createElement("div");
        entry.bar.className = "ui-tabs-bar";
        entry.bar.setAttribute("role", "tablist");
        entry.content = document.createElement("div");
        entry.content.className = "ui-tabs-body";
        entry.el.append(entry.bar, entry.content);
        entry.tabs = [];
      },
      tab(entry) {
        entry.el = entry.content = document.createElement("section");
        entry.el.className = "ui-tab-panel";
        entry.el.setAttribute("role", "tabpanel");
      },
      dialog(entry) {
        const dialog = document.createElement("dialog");
        dialog.className = "ui-dialog";
        const head = document.createElement("header");
        head.className = "ui-dialog-head";
        entry.titleEl = document.createElement("h3");
        entry.titleEl.className = "ui-dialog-title";
        const close = document.createElement("button");
        close.type = "button";
        close.className = "ui-dialog-close";
        close.setAttribute("aria-label", "إغلاق");
        close.textContent = "✕";
        close.addEventListener("click", () => dialog.close());
        head.append(entry.titleEl, close);
        entry.content = document.createElement("div");
        entry.content.className = "ui-dialog-body";
        dialog.append(head, entry.content);
        // أغلقها المستخدم (✕ أو Esc)، لا البرنامج: نخبر البرنامج
        dialog.addEventListener("close", () => {
          if (entry.props.open) {
            entry.props.open = false;
            this.send(entry.id, "close");
          }
        });
        entry.el = dialog;
      },
      chart(entry) {
        entry.el = document.createElement("figure");
        entry.el.className = "ui-chart";
        entry.titleEl = document.createElement("figcaption");
        entry.titleEl.className = "ui-chart-title";
        entry.titleEl.hidden = true;
        entry.legend = document.createElement("div");
        entry.legend.className = "ui-chart-legend";
        entry.plot = document.createElement("div");
        entry.plot.className = "ui-chart-plot";
        entry.tip = document.createElement("div");
        entry.tip.className = "ui-chart-tip";
        entry.tip.hidden = true;
        entry.plot.appendChild(entry.tip);
        entry.el.append(entry.titleEl, entry.legend, entry.plot);
        let lastWidth = 0;
        entry.resize = new ResizeObserver(() => {
          const width = entry.plot.clientWidth;
          if (width && Math.abs(width - lastWidth) > 1) {
            lastWidth = width;
            this.renderChart(entry);
          }
        });
        entry.resize.observe(entry.plot);
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
        const point = (event) => {
          const rect = canvas.getBoundingClientRect();
          return {
            x: Math.round(((event.clientX - rect.left) / rect.width) * width),
            y: Math.round(((event.clientY - rect.top) / rect.height) * height),
          };
        };
        const listens = (name) => (entry.props.listen || []).includes(name);
        let pressed = false;
        canvas.addEventListener("click", (event) => {
          if (listens("click")) this.send(entry.id, "click", point(event));
        });
        canvas.addEventListener("pointerdown", (event) => {
          pressed = true;
          canvas.setPointerCapture?.(event.pointerId);
          if (listens("down")) this.send(entry.id, "down", point(event));
        });
        canvas.addEventListener("pointermove", (event) => {
          // الحركات المتتالية تُدمج: يصل آخر موضع فقط إن كان البرنامج مشغولًا
          if (listens("move") || (pressed && listens("drag"))) {
            this.send(entry.id, "move", { ...point(event), pressed }, "latest");
          }
        });
        const release = (event) => {
          if (!pressed) return;
          pressed = false;
          if (listens("up")) this.send(entry.id, "up", point(event));
        };
        canvas.addEventListener("pointerup", release);
        canvas.addEventListener("pointercancel", release);
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
          if (entry.textEl && entry.kind !== "card") entry.textEl.textContent = value;
          else if (entry.kind === "card") this.update(entry, { title: value });
          else el.textContent = value ?? "";
          break;
        case "title":
          if (entry.kind === "tab") {
            if (entry.tabButton) entry.tabButton.textContent = value ?? "";
            break;
          }
          entry.titleEl.textContent = value ?? "";
          entry.titleEl.hidden = !value;
          break;
        case "value":
          if (entry.kind === "radio") {
            for (const input of control.querySelectorAll("input")) input.checked = input.value === value;
          } else if (entry.kind === "checkbox" || entry.kind === "switch") control.checked = Boolean(value);
          else if (entry.kind === "progress") el.value = Number(value) || 0;
          else if (control && control.value !== String(value ?? "")) control.value = value ?? "";
          if (entry.valueLabel) entry.valueLabel.textContent = control.value;
          break;
        case "placeholder": control.placeholder = value ?? ""; break;
        case "password": control.type = value ? "password" : "text"; break;
        case "rows":
          if (entry.kind === "table") {
            entry.view.selected = null;
            this.renderTable(entry);
          } else control.rows = value;
          break;
        case "sortable": case "selectable": case "pageSize": this.renderTable(entry); break;
        case "searchable": entry.search.hidden = !value; break;
        case "horizontal": el.classList.toggle("ui-radio-row", Boolean(value)); break;
        case "accept": if (value) control.accept = value; else control.removeAttribute("accept"); break;
        case "multiple": control.multiple = Boolean(value); break;
        case "selected": if (entry.kind === "tabs") this.selectTab(entry, value | 0, false); break;
        case "open":
          if (value && !el.open) el.showModal();
          else if (!value && el.open) el.close();
          break;
        case "chart": case "labels": case "series": case "stacked": this.renderChart(entry); break;
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
          if (entry.kind === "radio") {
            for (const option of value || []) {
              const label = document.createElement("label");
              const input = document.createElement("input");
              input.type = "radio";
              input.name = `ui-radio-${entry.id}`;
              input.value = option;
              input.checked = option === entry.props.value;
              input.addEventListener("change", () => this.send(entry.id, "change", option));
              const text = document.createElement("span");
              text.textContent = option;
              label.append(input, text);
              control.appendChild(label);
            }
            break;
          }
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
        case "listen":
          // اللمس على الهاتف: السحب يرسم بدل أن يمرر الصفحة
          el.style.touchAction = (value || []).some((n) => ["move", "drag", "down"].includes(n)) ? "none" : "";
          el.style.cursor = (value || []).length ? "crosshair" : "";
          break;
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
    s.margin = style.margin != null ? px(style.margin) : "";
    s.border = style.border || "";
    s.borderRadius = style.radius != null ? px(style.radius) : "";
    s.boxShadow = style.shadow ? "0 4px 14px rgba(16, 24, 40, 0.14)" : style.shadow === false ? "none" : "";
    s.opacity = style.opacity != null ? String(style.opacity) : "";
    s.fontStyle = style.italic ? "italic" : "";
    s.fontFamily = style.font === "mono" ? "var(--code-font)" : "";
  }

  // سمة الصفحة: اللون الأساسي والخلفية وحجم الخط والوضع الفاتح أو الداكن
  applyTheme(theme) {
    const target = this.root.closest("[data-ui-theme-target]") || this.root;
    target.classList.remove("ui-theme-light", "ui-theme-dark");
    for (const name of ["--accent", "--accent-hover", "--focus", "--bg", "background"]) target.style.removeProperty(name);
    this.root.style.fontSize = "";
    if (!theme) return;
    if (theme.mode === "light" || theme.mode === "dark") target.classList.add(`ui-theme-${theme.mode}`);
    if (theme.accent) {
      target.style.setProperty("--accent", theme.accent);
      target.style.setProperty("--accent-hover", theme.accent);
      target.style.setProperty("--focus", theme.accent);
    }
    if (theme.background) {
      target.style.setProperty("--bg", theme.background);
      target.style.background = theme.background;
    }
    if (theme.fontSize) this.root.style.fontSize = px(theme.fontSize);
  }

  // الفرز والبحث والتقسيم إلى صفحات في المتصفح نفسه (دون انتظار البرنامج)،
  // والاختيار يرسل رقم الصف الأصلي فيصل البرنامج إلى الكائن نفسه
  renderTable(entry) {
    const { columns = [], rows = [], sortable, selectable, pageSize } = entry.props;
    const view = entry.view;
    const table = entry.control;
    table.textContent = "";
    table.classList.toggle("ui-table-selectable", Boolean(selectable));
    const head = table.createTHead().insertRow();
    columns.forEach((column, index) => {
      const th = document.createElement("th");
      th.textContent = column;
      if (sortable) {
        th.classList.add("ui-sortable");
        th.tabIndex = 0;
        if (view.sort === index) th.dataset.sort = view.desc ? "desc" : "asc";
        const sort = () => {
          view.desc = view.sort === index ? !view.desc : false;
          view.sort = index;
          this.renderTable(entry);
        };
        th.addEventListener("click", sort);
        th.addEventListener("keydown", (event) => { if (event.key === "Enter") sort(); });
      }
      head.appendChild(th);
    });

    let order = rows.map((row, index) => index);
    if (view.query) order = order.filter((i) => rows[i].some((cell) => String(cell).toLowerCase().includes(view.query)));
    if (view.sort != null) {
      const k = view.sort;
      const number = (v) => (String(v).trim() === "" ? NaN : Number(String(v).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))));
      const numeric = order.every((i) => rows[i][k] === "" || !Number.isNaN(number(rows[i][k])));
      order.sort((a, b) => {
        const x = rows[a][k] ?? "";
        const y = rows[b][k] ?? "";
        const result = numeric ? (number(x) || 0) - (number(y) || 0) : String(x).localeCompare(String(y), "ar");
        return view.desc ? -result : result;
      });
    }
    const size = pageSize > 0 ? pageSize : order.length || 1;
    const pages = Math.max(1, Math.ceil(order.length / size));
    view.page = Math.min(view.page, pages - 1);
    const shown = order.slice(view.page * size, view.page * size + size);

    const body = table.createTBody();
    for (const index of shown) {
      const tr = body.insertRow();
      for (const cell of rows[index]) tr.insertCell().textContent = cell;
      if (selectable) {
        tr.tabIndex = 0;
        tr.classList.toggle("ui-selected", view.selected === index);
        const choose = () => {
          view.selected = index;
          for (const other of body.rows) other.classList.remove("ui-selected");
          tr.classList.add("ui-selected");
          this.send(entry.id, "select", index);
        };
        tr.addEventListener("click", choose);
        tr.addEventListener("keydown", (event) => { if (event.key === "Enter") choose(); });
      }
    }
    if (!shown.length && (view.query || rows.length)) {
      const td = body.insertRow().insertCell();
      td.colSpan = Math.max(1, columns.length);
      td.className = "ui-table-empty";
      td.textContent = "لا توجد نتائج";
    }

    entry.pager.hidden = !(pageSize > 0 && pages > 1);
    entry.pager.textContent = "";
    if (!entry.pager.hidden) {
      const button = (text, page, label) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ui-button";
        b.dataset.variant = "secondary";
        b.textContent = text;
        b.setAttribute("aria-label", label);
        b.disabled = page < 0 || page >= pages;
        b.addEventListener("click", () => { view.page = page; this.renderTable(entry); });
        return b;
      };
      const info = document.createElement("span");
      info.textContent = `صفحة ${view.page + 1} من ${pages} (${order.length} صفًا)`;
      entry.pager.append(button("→ السابقة", view.page - 1, "الصفحة السابقة"), info,
        button("التالية ←", view.page + 1, "الصفحة التالية"));
    }
  }

  // -------------------------------------------------------------------------
  // الرسوم البيانية (SVG): أعمدة، خطي، مساحي، دائري، حلقي
  // -------------------------------------------------------------------------
  renderChart(entry) {
    if (!entry.plot) return;
    const width = entry.plot.clientWidth;
    const { chart = "bar", labels = [], series = [], height = 300, stacked } = entry.props;
    for (const node of [...entry.plot.childNodes]) if (node !== entry.tip) node.remove();
    entry.tip.hidden = true;
    if (!width) return;
    const color = (i) => `var(--chart-${(i % 8) + 1})`;
    const fmt = new Intl.NumberFormat("ar", { numberingSystem: "latn", maximumFractionDigits: 2 });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.classList.add("ui-chart-svg");
    const el = (name, attrs, parent = svg) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", name);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      parent.appendChild(node);
      return node;
    };
    const tip = (event, html) => {
      entry.tip.hidden = false;
      entry.tip.innerHTML = html;
      const box = entry.plot.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      entry.tip.style.left = `${Math.min(Math.max(x + 12, 0), width - entry.tip.offsetWidth)}px`;
      entry.tip.style.top = `${Math.max(y - entry.tip.offsetHeight - 10, 0)}px`;
    };
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const swatch = (i) => `<i style="background:${color(i)}"></i>`;
    svg.addEventListener("mouseleave", () => { entry.tip.hidden = true; });

    // وسيلة الإيضاح: للسلاسل المتعددة، ولتسميات الرسم الدائري
    const named = series.filter((s) => s.name);
    const legendItems = chart === "pie" || chart === "donut" ? labels : (series.length > 1 ? series.map((s) => s.name) : []);
    entry.legend.innerHTML = legendItems.map((name, i) => `<span>${swatch(i)}${esc(name)}</span>`).join("");
    entry.legend.hidden = !legendItems.length;
    entry.el.setAttribute("aria-label", entry.props.title || named.map((s) => s.name).join("، ") || "رسم بياني");

    if (chart === "pie" || chart === "donut") {
      const values = (series[0]?.values || []).map((v) => Math.max(0, v || 0));
      const total = values.reduce((a, b) => a + b, 0) || 1;
      const r = Math.min(width, height) / 2 - 8;
      const cx = width / 2;
      const cy = height / 2;
      const inner = chart === "donut" ? r * 0.58 : 0;
      let angle = -Math.PI / 2;
      values.forEach((value, i) => {
        const sweep = (value / total) * Math.PI * 2;
        if (!sweep) return;
        const end = angle + sweep;
        const large = sweep > Math.PI ? 1 : 0;
        const p = (rad, radius) => `${cx + radius * Math.cos(rad)} ${cy + radius * Math.sin(rad)}`;
        const full = sweep >= Math.PI * 2 - 1e-6;
        const d = full
          ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0` + (inner ? ` M ${cx - inner} ${cy} a ${inner} ${inner} 0 1 1 ${2 * inner} 0 a ${inner} ${inner} 0 1 1 ${-2 * inner} 0` : "")
          : inner
            ? `M ${p(angle, r)} A ${r} ${r} 0 ${large} 1 ${p(end, r)} L ${p(end, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(angle, inner)} Z`
            : `M ${cx} ${cy} L ${p(angle, r)} A ${r} ${r} 0 ${large} 1 ${p(end, r)} Z`;
        const slice = el("path", { d, "fill-rule": "evenodd", class: "ui-chart-mark" });
        slice.style.fill = color(i);
        const percent = Math.round((value / total) * 100);
        slice.addEventListener("mousemove", (event) => tip(event, `${swatch(i)}<b>${esc(labels[i] ?? "")}</b> ${fmt.format(value)} <bdi dir="ltr">(${percent}%)</bdi>`));
        angle = end;
      });
      if (inner) {
        const label = el("text", { x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "middle", class: "ui-chart-total" });
        label.textContent = fmt.format(values.reduce((a, b) => a + b, 0));
      }
      entry.plot.insertBefore(svg, entry.tip);
      return;
    }

    // المحاور: قيم ص «مستديرة» وخطوط شبكة خفيفة
    const n = labels.length;
    const sums = labels.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0));
    const all = series.flatMap((s) => s.values.filter((v) => v != null));
    let max = stacked && chart !== "line" ? Math.max(0, ...sums) : Math.max(0, ...all);
    let min = Math.min(0, ...all);
    if (max === min) max = min + 1;
    const step = (() => {
      const raw = (max - min) / 5;
      const mag = 10 ** Math.floor(Math.log10(raw));
      return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw);
    })();
    max = Math.ceil(max / step) * step;
    min = Math.floor(min / step) * step;
    const ticks = [];
    for (let v = min; v <= max + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
    const left = Math.max(...ticks.map((t) => fmt.format(t).length)) * 7 + 14;
    const top = 10;
    const bottom = 30;
    const plotW = Math.max(10, width - left - 8);
    const plotH = Math.max(10, height - top - bottom);
    const y = (v) => top + plotH - ((v - min) / (max - min)) * plotH;
    const band = plotW / Math.max(n, 1);
    const xCenter = (i) => left + band * i + band / 2;
    for (const t of ticks) {
      el("line", { x1: left, x2: left + plotW, y1: y(t), y2: y(t), class: t === 0 ? "ui-chart-base" : "ui-chart-grid" });
      const label = el("text", { x: left - 8, y: y(t), "text-anchor": "end", "dominant-baseline": "middle", class: "ui-chart-axis" });
      label.textContent = fmt.format(t);
    }
    // تسميات س: نتخطى بعضها إن ازدحمت
    const every = Math.max(1, Math.ceil((n * 64) / plotW));
    labels.forEach((text, i) => {
      if (i % every) return;
      const label = el("text", { x: xCenter(i), y: height - 10, "text-anchor": "middle", class: "ui-chart-axis" });
      label.textContent = text;
    });
    const tipAt = (event, i) => tip(event, `<b>${esc(labels[i] ?? "")}</b>` + series.map((s, k) =>
      `<div>${series.length > 1 ? swatch(k) + esc(s.name) + ": " : ""}${s.values[i] == null ? "—" : fmt.format(s.values[i])}</div>`).join(""));

    if (chart === "bar") {
      const groups = stacked ? 1 : series.length;
      const inner = band * 0.72;
      const barW = Math.max(2, (inner - 2 * (groups - 1)) / groups);
      labels.forEach((_, i) => {
        let base = 0;
        series.forEach((s, k) => {
          const v = s.values[i];
          if (v == null) return;
          const x0 = left + band * i + (band - inner) / 2 + (stacked ? 0 : k * (barW + 2));
          const from = stacked ? base : 0;
          const to = stacked ? base + Math.max(0, v) : v;
          if (stacked) base = to;
          const yTop = y(Math.max(from, to));
          const yBottom = y(Math.min(from, to));
          const h = Math.max(0, yBottom - yTop - (stacked && k ? 2 : 0));
          const rr = Math.min(4, barW / 2, h);
          // أطراف مستديرة بعيدًا عن خط الأساس فقط
          const up = to >= from;
          const d = up
            ? `M ${x0} ${yBottom} V ${yTop + rr} Q ${x0} ${yTop} ${x0 + rr} ${yTop} H ${x0 + barW - rr} Q ${x0 + barW} ${yTop} ${x0 + barW} ${yTop + rr} V ${yBottom} Z`
            : `M ${x0} ${yTop} V ${yBottom - rr} Q ${x0} ${yBottom} ${x0 + rr} ${yBottom} H ${x0 + barW - rr} Q ${x0 + barW} ${yBottom} ${x0 + barW} ${yBottom - rr} V ${yTop} Z`;
          const bar = el("path", { d, class: "ui-chart-mark" });
          bar.style.fill = color(k);
          bar.addEventListener("mousemove", (event) => tipAt(event, i));
        });
      });
    } else {
      // خطي ومساحي: خط رفيع، ونقاط عند المرور، وخط عمودي يتبع الفأرة
      series.forEach((s, k) => {
        const points = s.values.map((v, i) => (v == null ? null : [xCenter(i), y(v)]));
        const segments = [];
        let current = [];
        for (const p of points) {
          if (p) current.push(p);
          else if (current.length) { segments.push(current); current = []; }
        }
        if (current.length) segments.push(current);
        for (const seg of segments) {
          const d = seg.map(([px_, py], j) => `${j ? "L" : "M"} ${px_} ${py}`).join(" ");
          if (chart === "area") {
            const area = el("path", { d: `${d} L ${seg.at(-1)[0]} ${y(Math.max(min, 0))} L ${seg[0][0]} ${y(Math.max(min, 0))} Z`, class: "ui-chart-area" });
            area.style.fill = color(k);
          }
          const line = el("path", { d, class: "ui-chart-line" });
          line.style.stroke = color(k);
          if (seg.length === 1) {
            const dot = el("circle", { cx: seg[0][0], cy: seg[0][1], r: 4, class: "ui-chart-dot" });
            dot.style.fill = color(k);
          }
        }
      });
      const cross = el("line", { y1: top, y2: top + plotH, class: "ui-chart-cross" });
      cross.style.display = "none";
      const dots = series.map((s, k) => {
        const dot = el("circle", { r: 4, class: "ui-chart-dot" });
        dot.style.fill = color(k);
        dot.style.display = "none";
        return dot;
      });
      const hit = el("rect", { x: left, y: top, width: plotW, height: plotH, fill: "transparent" });
      hit.addEventListener("mousemove", (event) => {
        const box = svg.getBoundingClientRect();
        const i = Math.min(n - 1, Math.max(0, Math.floor((event.clientX - box.left - left) / band)));
        cross.setAttribute("x1", xCenter(i));
        cross.setAttribute("x2", xCenter(i));
        cross.style.display = "";
        series.forEach((s, k) => {
          const v = s.values[i];
          dots[k].style.display = v == null ? "none" : "";
          if (v != null) { dots[k].setAttribute("cx", xCenter(i)); dots[k].setAttribute("cy", y(v)); }
        });
        tipAt(event, i);
      });
      hit.addEventListener("mouseleave", () => {
        cross.style.display = "none";
        dots.forEach((d) => { d.style.display = "none"; });
      });
    }
    entry.plot.insertBefore(svg, entry.tip);
  }

  // -------------------------------------------------------------------------
  // الألسنة
  // -------------------------------------------------------------------------
  addTab(tabs, pane) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-tab";
    button.setAttribute("role", "tab");
    button.textContent = pane.props.title ?? "";
    button.addEventListener("click", () => {
      const index = tabs.tabs.indexOf(pane);
      if (index !== tabs.props.selected) {
        this.selectTab(tabs, index, true);
        this.send(tabs.id, "change", index);
      }
    });
    pane.tabButton = button;
    pane.tabsEntry = tabs;
    tabs.tabs.push(pane);
    tabs.bar.appendChild(button);
    this.selectTab(tabs, tabs.props.selected ?? 0, false);
  }

  selectTab(tabs, index, fromUser) {
    tabs.props.selected = index;
    tabs.tabs.forEach((pane, i) => {
      pane.el.hidden = i !== index;
      pane.tabButton.setAttribute("aria-selected", String(i === index));
      pane.tabButton.tabIndex = i === index ? 0 : -1;
    });
    if (fromUser) tabs.tabs[index]?.tabButton.focus();
  }

  // -------------------------------------------------------------------------
  // الملفات
  // -------------------------------------------------------------------------
  async upload(entry, input) {
    const LIMIT = 10 * 1024 * 1024;
    const files = [...input.files];
    input.value = "";   // اختيار الملف نفسه مرة أخرى يعمل أيضًا
    const big = files.find((file) => file.size > LIMIT);
    if (big) {
      this.options.onToast?.(`الملف «${big.name}» أكبر من ١٠ ميغابايت`, "error");
      return;
    }
    const read = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const data = await Promise.all(files.map(async (file) => ({
      name: file.name, type: file.type, size: file.size, data: await read(file),
    })));
    if (data.length) this.send(entry.id, "upload", data);
  }

  download({ name, type, data }) {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name || "ملف";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
    if (entry.tabsEntry) {
      const tabs = entry.tabsEntry;
      tabs.tabs = tabs.tabs.filter((pane) => pane !== entry);
      entry.tabButton.remove();
      this.selectTab(tabs, Math.min(tabs.props.selected ?? 0, tabs.tabs.length - 1), false);
    }
    entry.resize?.disconnect();
    entry.el.remove();
  }

  clear(id) {
    const entry = id == null ? null : this.entries.get(id);
    const container = id == null ? this.root : entry?.content;
    if (!container) return;
    if (entry?.kind === "tabs") {
      entry.tabs = [];
      entry.bar.textContent = "";
    }
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

  // أوامر الرسم تُنفَّذ بالترتيب. الصورة التي لم تُحمَّل بعد توقف ما بعدها حتى تجهز،
  // فلا يُرسم شكل تحتها وهو مكتوب بعدها في البرنامج.
  draw(entry, commands) {
    if (!entry || !entry.ctx) return;
    entry.pending = (entry.pending || []).concat(commands);
    this.drawPending(entry);
  }

  drawPending(entry) {
    while (entry.pending.length) {
      const command = entry.pending[0];
      if (command[0] === "image") {
        const image = this.loadImage(command[1]);
        if (!image.complete) {
          if (!image.waiting?.has(entry)) {
            (image.waiting ||= new Set()).add(entry);
          }
          return;
        }
      }
      entry.pending.shift();
      this.drawOne(entry, command);
    }
  }

  loadImage(url) {
    this.images ||= new Map();
    let image = this.images.get(url);
    if (!image) {
      image = new Image();
      image.crossOrigin = "anonymous";
      const done = () => {
        const waiting = image.waiting || new Set();
        image.waiting = null;
        for (const entry of waiting) if (this.entries.get(entry.id) === entry) this.drawPending(entry);
      };
      image.onload = done;
      image.onerror = () => {
        console.warn("واجهات: تعذّر تحميل الصورة", url);
        image.failed = true;
        done();
      };
      image.src = safeUrl(url) || new URL(String(url), document.baseURI).href;
      this.images.set(url, image);
    }
    return image;
  }

  drawOne(entry, [type, ...a]) {
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
        if (a[7] > 0 && ctx.roundRect) ctx.roundRect(a[0], a[1], a[2], a[3], a[7]);
        else ctx.rect(a[0], a[1], a[2], a[3]);
        finish(a[4], a[5], a[6]);
        break;
      case "circle":
        ctx.beginPath();
        ctx.arc(a[0], a[1], Math.max(0, a[2]), 0, Math.PI * 2);
        finish(a[3], a[4], a[5]);
        break;
      case "ellipse":
        ctx.beginPath();
        ctx.ellipse(a[0], a[1], Math.max(0, a[2]), Math.max(0, a[3]), 0, 0, Math.PI * 2);
        finish(a[4], a[5], a[6]);
        break;
      case "arc":
        ctx.beginPath();
        ctx.arc(a[0], a[1], Math.max(0, a[2]), (a[3] * Math.PI) / 180, (a[4] * Math.PI) / 180);
        finish(a[5], null, a[6]);
        break;
      case "poly":
        ctx.beginPath();
        (a[0] || []).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        finish(a[1], a[2], a[3]);
        break;
      case "text":
        ctx.font = `${a[6] ? "700 " : ""}${a[4] || 16}px "IBM Plex Sans Arabic", system-ui, sans-serif`;
        ctx.fillStyle = a[3] || "#111827";
        ctx.textAlign = a[5] || "center";
        ctx.textBaseline = "middle";
        ctx.direction = "rtl";
        ctx.fillText(a[0], a[1], a[2]);
        break;
      case "image": {
        const image = this.loadImage(a[0]);
        if (image.failed || !image.naturalWidth) break;
        const w = a[3] ?? (a[4] != null ? (image.naturalWidth * a[4]) / image.naturalHeight : image.naturalWidth);
        const h = a[4] ?? (image.naturalHeight * w) / image.naturalWidth;
        ctx.drawImage(image, a[1], a[2], w, h);
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // لوحة المفاتيح: ضغطات الصفحة كلها ما عدا الكتابة في الحقول والمحرر
  // -------------------------------------------------------------------------
  listenKeys(id) {
    this.keysId = id;
    // البرنامج يستقبل المفاتيح: ننقل التركيز إلى التطبيق (من المحرر أو قائمة الأمثلة)
    // وإلا ذهبت الأسهم إلى المحرر حتى يضغط المستخدم على التطبيق
    if (!this.root.contains(document.activeElement)) {
      this.root.tabIndex = -1;
      this.root.focus({ preventScroll: true });
    }
    if (this.keyHandler) return;
    const editable = (target) => target instanceof Element
      && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])"));
    const GAME_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "]);
    this.keyHandler = (event) => {
      if (this.keysId == null || editable(event.target) || event.ctrlKey || event.metaKey) return;
      if (event.type === "keydown" && GAME_KEYS.has(event.key)) event.preventDefault();
      // الضغط المستمر يكرر الحدث: التكرار يُهمل إن كان البرنامج ما زال يعالج السابق
      this.send(this.keysId, event.type, { key: event.key }, event.repeat ? "drop" : "queue");
    };
    this.blurHandler = () => { if (this.keysId != null) this.send(this.keysId, "blur"); };
    document.addEventListener("keydown", this.keyHandler);
    document.addEventListener("keyup", this.keyHandler);
    window.addEventListener("blur", this.blurHandler);
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
