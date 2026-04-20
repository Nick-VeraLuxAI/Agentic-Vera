const currentSessionId = localStorage.getItem("current_session_id") || `session-${Date.now()}`;
localStorage.setItem("current_session_id", currentSessionId);

let allConversations = JSON.parse(localStorage.getItem("vera_conversations") || "{}");
if (!allConversations[currentSessionId]) allConversations[currentSessionId] = [];
let conversationHistory = allConversations[currentSessionId];

if (!localStorage.getItem("sessionId")) {
  localStorage.setItem("sessionId", `session-${Date.now()}`);
}
const sessionId = localStorage.getItem("sessionId");

let reader = null;
let isStreaming = false;
let selectedFiles = [];
let abortController = null;
let shouldStop = false;
let activeThreadMenu = null;
const THEME_STORAGE_KEY = "vera_theme";
const SYSTEM_THEME_QUERY = window.matchMedia("(prefers-color-scheme: dark)");
let selectedThemeMode = "system";
const THEME_CLASS_MAP = {
  "dark-glass": "",
  "daylight-clean": "theme-daylight-clean",
  "midnight-minimal": "theme-midnight-minimal",
  "neo-terminal": "theme-neo-terminal",
};

function persistConversations() {
  allConversations[currentSessionId] = conversationHistory;
  localStorage.setItem("vera_conversations", JSON.stringify(allConversations));
}

function saveToConversation(role, content) {
  conversationHistory.push({ role, content, timestamp: Date.now() });
  persistConversations();
}

function showTyping(state) {
  document.getElementById("typing-indicator").classList.toggle("hidden", !state);
}

function resolveTheme(themeMode) {
  if (themeMode === "system") {
    return SYSTEM_THEME_QUERY.matches ? "dark-glass" : "daylight-clean";
  }
  return THEME_CLASS_MAP[themeMode] !== undefined ? themeMode : "dark-glass";
}

function applyTheme(themeMode, persist = true) {
  const value = resolveTheme(themeMode);
  Object.values(THEME_CLASS_MAP).forEach((className) => {
    if (className) document.body.classList.remove(className);
  });
  const mapped = THEME_CLASS_MAP[value];
  if (mapped) document.body.classList.add(mapped);
  selectedThemeMode = themeMode;
  if (persist) {
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }
  const selector = document.getElementById("theme-select");
  if (selector && selector.value !== themeMode) selector.value = themeMode;
}

function initThemeControls() {
  const rawStored = localStorage.getItem(THEME_STORAGE_KEY) || "system";
  const stored = rawStored === "system" || THEME_CLASS_MAP[rawStored] !== undefined ? rawStored : "system";
  applyTheme(stored);
  const selector = document.getElementById("theme-select");
  if (!selector) return;
  selector.value = stored;
  selector.addEventListener("change", (event) => {
    applyTheme(event.target.value);
  });
  SYSTEM_THEME_QUERY.addEventListener("change", () => {
    if (selectedThemeMode === "system") {
      applyTheme("system", false);
    }
  });
}

function closeThreadMenu() {
  if (!activeThreadMenu) return;
  activeThreadMenu.classList.remove("visible");
  const trigger = activeThreadMenu.previousElementSibling;
  if (trigger?.classList.contains("options-btn")) {
    trigger.setAttribute("aria-expanded", "false");
  }
  activeThreadMenu = null;
}

function buildThreads(messages) {
  const threads = [];
  let current = [];
  for (const message of messages) {
    if (message.role === "user" && current.length) {
      threads.push(current);
      current = [];
    }
    current.push(message);
  }
  if (current.length) threads.push(current);
  return threads;
}

function replayConversation(messages) {
  const log = document.getElementById("chat-log");
  log.innerHTML = "";
  messages.forEach((msg) => {
    const role = msg.role === "assistant" ? "vera" : msg.role;
    appendMessage(role, msg.content, true);
  });
}

function renameThread(sessionKey, threadMessages) {
  const firstUser = threadMessages.find((m) => m.role === "user");
  if (!firstUser) return;
  const value = window.prompt("Rename thread", firstUser.content || "");
  if (value === null) return;
  const title = value.trim();
  if (!title) return;
  firstUser.content = title;
  persistConversations();
  renderConversationHistory();
}

function deleteThread(sessionKey, threadMessages) {
  if (!window.confirm("Delete this thread?")) return;
  allConversations[sessionKey] = allConversations[sessionKey].filter((m) => !threadMessages.includes(m));
  persistConversations();
  renderConversationHistory();
}

function createThreadItem(sessionKey, threadMessages, index) {
  const li = document.createElement("li");
  li.className = "thread-item";
  li.setAttribute("role", "button");
  li.setAttribute("tabindex", "0");
  li.setAttribute("aria-label", "Open conversation thread");

  const firstUser = threadMessages.find((m) => m.role === "user");
  const title = (firstUser?.content || `Conversation ${index + 1}`).slice(0, 60);

  const content = document.createElement("div");
  content.className = "thread-content";
  content.textContent = title;
  li.appendChild(content);

  const menu = document.createElement("div");
  const menuId = `thread-menu-${sessionKey}-${index}`;
  menu.id = menuId;
  menu.className = "thread-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-hidden", "true");

  const optionsBtn = document.createElement("button");
  optionsBtn.type = "button";
  optionsBtn.className = "options-btn";
  optionsBtn.textContent = "⋯";
  optionsBtn.setAttribute("aria-haspopup", "menu");
  optionsBtn.setAttribute("aria-expanded", "false");
  optionsBtn.setAttribute("aria-controls", menuId);
  optionsBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = menu.classList.contains("visible");
    closeThreadMenu();
    if (!isOpen) {
      menu.classList.add("visible");
      menu.setAttribute("aria-hidden", "false");
      optionsBtn.setAttribute("aria-expanded", "true");
      activeThreadMenu = menu;
    }
  });
  li.appendChild(optionsBtn);

  const rename = document.createElement("button");
  rename.type = "button";
  rename.className = "menu-item";
  rename.textContent = "Rename";
  rename.addEventListener("click", (event) => {
    event.stopPropagation();
    closeThreadMenu();
    renameThread(sessionKey, threadMessages);
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "menu-item";
  remove.textContent = "Delete";
  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    closeThreadMenu();
    deleteThread(sessionKey, threadMessages);
  });

  menu.appendChild(rename);
  menu.appendChild(remove);
  li.appendChild(menu);

  const openThread = () => {
    if (menu.classList.contains("visible")) return;
    replayConversation(threadMessages);
  };
  li.addEventListener("click", openThread);
  li.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openThread();
    } else if (event.key === "Escape") {
      closeThreadMenu();
    }
  });

  return li;
}

function renderConversationHistory() {
  const panel = document.querySelector('.tab-panel[data-tab="conversations"]');
  panel.innerHTML = "";

  const sessionEntries = Object.entries(allConversations);
  if (!sessionEntries.length) {
    panel.textContent = "No conversations yet.";
    return;
  }

  for (const [sessionKey, messages] of sessionEntries) {
    const sessionDiv = document.createElement("div");
    sessionDiv.className = "session-group";

    const header = document.createElement("h4");
    header.textContent = `Session: ${sessionKey}`;
    sessionDiv.appendChild(header);

    const ul = document.createElement("ul");
    ul.className = "conversation-list";

    const threads = buildThreads(messages);
    threads.forEach((thread, idx) => {
      ul.appendChild(createThreadItem(sessionKey, thread, idx));
    });

    sessionDiv.appendChild(ul);
    panel.appendChild(sessionDiv);
  }

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.textContent = "Clear All Conversations";
  clearBtn.className = "clear-btn";
  clearBtn.addEventListener("click", () => {
    if (!window.confirm("Clear all saved conversations?")) return;
    localStorage.removeItem("vera_conversations");
    allConversations = {};
    conversationHistory = [];
    renderConversationHistory();
  });
  panel.appendChild(clearBtn);
}

function resetInput() {
  const input = document.getElementById("message");
  const button = document.getElementById("send-btn");
  input.disabled = false;
  button.disabled = false;
  selectedFiles = [];
  document.getElementById("file-preview").innerHTML = "";
  showTyping(false);
}

function cleanupAfterStream(message) {
  const button = document.getElementById("send-btn");
  const last = document.querySelector(".message.vera:last-child");
  if (last) last.innerText = message;
  isStreaming = false;
  button.textContent = "➤";
  resetInput();
  reader = null;
  abortController = null;
}

async function sendMessage() {
  if (isStreaming && reader && abortController) {
    shouldStop = true;
    abortController.abort();
    reader.cancel();
    cleanupAfterStream("⛔ Stopped by user.");
    return;
  }

  const input = document.getElementById("message");
  const button = document.getElementById("send-btn");
  const text = input.value.trim();
  if (!text && selectedFiles.length === 0) return;

  abortController = new AbortController();
  shouldStop = false;
  isStreaming = true;
  button.textContent = "⏹";
  input.disabled = true;
  showTyping(true);

  appendMessage("user", text || "[Uploaded files only]");
  input.value = "";

  const formData = new FormData();
  formData.append("message", text);
  selectedFiles.forEach((file) => formData.append("files", file));

  const container = document.createElement("div");
  container.className = "message vera";
  document.getElementById("chat-log").appendChild(container);
  container.scrollIntoView({ behavior: "smooth" });

  let typingTimeout = null;
  let assistantReply = "";

  const finalize = () => {
    isStreaming = false;
    button.textContent = "➤";
    clearTimeout(typingTimeout);
    showTyping(false);
    container.innerHTML = renderMarkdownWithHighlight(assistantReply);
    resetInput();
    reader = null;
    abortController = null;
  };

  try {
    const response = await fetch("/api/message-stream", {
      method: "POST",
      headers: { "x-session-id": sessionId },
      body: formData,
      signal: abortController.signal,
    });
    if (!response.ok || !response.body) throw new Error("Stream failed");

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let partial = "";

    while (true) {
      if (shouldStop) return;
      const { value, done } = await reader.read();
      if (done) break;

      partial += decoder.decode(value, { stream: true });
      const events = partial.split(/\n{2,}/);
      partial = events.pop() || "";

      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        reader.cancel();
        finalize();
      }, 1500);

      for (const event of events) {
        if (!event.startsWith("data: ")) continue;
        const data = event.slice(6).trim();
        if (data === "[DONE]") {
          finalize();
          if (assistantReply.trim()) {
            saveToConversation("assistant", assistantReply);
          }
          renderConversationHistory();
          return;
        }

        if (data.startsWith("[Error]")) {
          container.innerText = `⚠️ ${data}`;
          container.classList.add("error");
          return;
        }

        const cleaned = data.replace(/<\/s>|>+$/g, "").trim();
        if (!cleaned) continue;

        if (assistantReply && !/[ \n\t]$/.test(assistantReply) && !/^[.,!?'):\]]/.test(cleaned)) {
          assistantReply += " ";
        }
        assistantReply += cleaned;
        container.innerText = assistantReply;
      }

      container.scrollIntoView({ behavior: "smooth" });
    }

    finalize();
    if (assistantReply.trim()) {
      saveToConversation("assistant", assistantReply);
      renderConversationHistory();
    }
  } catch (err) {
    if (err.name === "AbortError" || shouldStop) {
      cleanupAfterStream("⛔ Stopped by user.");
    } else {
      cleanupAfterStream("⚠️ Vera didn’t respond.");
    }
  }
}

function appendMessage(sender, text, skipSave = false) {
  const msg = document.createElement("div");
  const roleClass = sender === "assistant" ? "vera" : sender;
  msg.className = `message ${roleClass}`;
  msg.innerHTML = roleClass === "vera" ? renderMarkdownWithHighlight(text) : text;
  document.getElementById("chat-log").appendChild(msg);
  msg.scrollIntoView({ behavior: "smooth" });
  if (!skipSave) {
    saveToConversation(sender, text);
    renderConversationHistory();
  }
}

function renderLongTermMemory() {
  const panel = document.querySelector('.tab-panel[data-tab="memory"]');
  panel.innerHTML = "";
  fetch("/api/memory/longterm")
    .then((res) => res.json())
    .then((facts) => {
      if (!Array.isArray(facts) || facts.length === 0) {
        panel.textContent = "No memory items yet.";
        return;
      }

      facts.forEach((fact) => {
        const div = document.createElement("div");
        div.className = "memory-item";

        const text = document.createElement("pre");
        text.textContent = JSON.stringify(fact, null, 2);
        div.appendChild(text);

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.textContent = "🗑 Forget";
        deleteBtn.addEventListener("click", async () => {
          const key = fact.original || fact.text || fact.subject;
          if (!key) {
            window.alert("This memory item cannot be deleted.");
            return;
          }
          const response = await fetch("/api/memory/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key }),
          });
          if (response.ok) renderLongTermMemory();
          else window.alert("Failed to delete memory.");
        });

        div.appendChild(deleteBtn);
        panel.appendChild(div);
      });
    })
    .catch(() => {
      panel.textContent = "⚠️ Error loading memory.";
    });
}

document.getElementById("file-upload").addEventListener("change", function onFileInputChange() {
  const preview = document.getElementById("file-preview");
  Array.from(this.files).forEach((file) => {
    selectedFiles.push(file);

    const div = document.createElement("div");
    div.className = "file-thumb";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "x";
    removeBtn.title = "Remove";
    removeBtn.addEventListener("click", () => {
      preview.removeChild(div);
      selectedFiles = selectedFiles.filter((f) => f !== file);
    });
    div.appendChild(removeBtn);

    if (file.type.startsWith("image/")) {
      const fileReader = new FileReader();
      fileReader.onload = (event) => {
        const img = document.createElement("img");
        img.src = event.target.result;
        img.alt = file.name;
        img.className = "thumb-img";
        div.appendChild(img);
      };
      fileReader.readAsDataURL(file);
    } else if (file.name.toLowerCase().endsWith(".pdf")) {
      const canvas = document.createElement("canvas");
      div.appendChild(canvas);
      const fileReader = new FileReader();
      fileReader.onload = async (event) => {
        try {
          const pdfData = new Uint8Array(event.target.result);
          const pdf = await window.pdfjsLib.getDocument({ data: pdfData }).promise;
          const page = await pdf.getPage(1);
          const rawViewport = page.getViewport({ scale: 1 });
          const scale = 80 / Math.max(rawViewport.width, rawViewport.height);
          const viewport = page.getViewport({ scale });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const context = canvas.getContext("2d");
          await page.render({ canvasContext: context, viewport }).promise;
          canvas.className = "thumb-img";
        } catch {
          canvas.remove();
          const fallback = document.createElement("div");
          fallback.className = "unsupported-icon";
          fallback.textContent = "❌";
          div.appendChild(fallback);
        }
      };
      fileReader.readAsArrayBuffer(file);
    }

    div.title = file.name;
    preview.appendChild(div);
  });
  this.value = "";
});

document.getElementById("message").addEventListener("keypress", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

document.addEventListener("click", (event) => {
  if (activeThreadMenu && !activeThreadMenu.contains(event.target) && !event.target.classList.contains("options-btn")) {
    closeThreadMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeThreadMenu();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll(".sidebar-tabs .tab");
  const panels = document.querySelectorAll(".tab-panel");
  tabs.forEach((tab, idx) => {
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", idx === 0 ? "true" : "false");
    tab.addEventListener("click", () => {
      tabs.forEach((t) => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      panels.forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      const panelKey = tab.getAttribute("data-tab");
      document.querySelector(`.tab-panel[data-tab="${panelKey}"]`).classList.add("active");
    });
  });

  const toggleBtn = document.getElementById("sidebar-toggle");
  const sidebar = document.getElementById("sidebar");
  toggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    toggleBtn.setAttribute("aria-expanded", sidebar.classList.contains("collapsed") ? "false" : "true");
  });

  initThemeControls();
  renderConversationHistory();
  renderLongTermMemory();
});

window.sendMessage = sendMessage;