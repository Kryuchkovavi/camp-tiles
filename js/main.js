import { spots as initialSpots } from "./data.js";

const STORAGE_KEY = "campTilesDemo_v1";
function isoDateWithOffset(offset) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function defaultCampingStart() {
  const now = new Date();
  const seasonYear = now.getMonth() >= 5 ? now.getFullYear() + 1 : now.getFullYear();
  return `${seasonYear}-06-01`;
}
function addDaysToISO(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function daysBetween(start, end) {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000);
}
function formatDate(isoDate) {
  if (!isoDate) return "—";
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(year, month - 1, day, 12));
}
const state = {
  spots: initialSpots.map(spot => ({ ...spot })),
  selectedId: null,
  filterGuests: 1,
  minPrice: 800,
  maxPrice: 3000,
  guests: 2,
  startDate: defaultCampingStart(),
  endDate: addDaysToISO(defaultCampingStart(), 2),
  nights: 2,
  bookings: [],
  users: [],
  currentUserId: null,
  storageAvailable: true,
  storageMessage: ""
};

const $ = selector => document.querySelector(selector);
const mapSpots = $("#map-spots");
const spotList = $("#spot-list");
const emptyState = $("#empty-state");
const resultCount = $("#result-count");
const selectedCard = $("#selected-card");
const totalPrice = $("#total-price");
const priceBreakdown = $("#price-breakdown");
const guestsInput = $("#booking-guests");
const nightsInput = $("#booking-nights");
const confirmButton = $("#confirm-booking");
const formMessage = $("#form-message");
const bookingsList = $("#bookings-list");
const bookingsEmpty = $("#bookings-empty");
const storageMessage = $("#storage-message");
const toast = $("#toast");
const dialog = $("#confirm-dialog");
const selectionCta = $("#selection-cta");
const selectionCtaTitle = $("#selection-cta-title");
const selectionCtaText = $("#selection-cta-text");
let toastTimer;
let pendingAction = null;
let pendingBookingAfterAuth = false;
let authMode = "register";

const formatMoney = value => new Intl.NumberFormat("ru-RU").format(value) + " ₽";
const getSpot = id => state.spots.find(spot => spot.id === id);
const activeBookingFor = id => state.bookings.find(booking => {
  if (booking.spotId !== id || booking.status !== "active") return false;
  // Legacy demo bookings without dates remain unavailable until cancelled.
  if (!booking.startDate || !booking.endDate) return true;
  return booking.startDate < state.endDate && booking.endDate > state.startDate;
});
const isOccupied = spot => spot.occupied || Boolean(activeBookingFor(spot.id));

function announce(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function loadSavedData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || !Array.isArray(saved.bookings)) {
      throw new Error("Неверный формат сохранённых данных.");
    }
    state.users = Array.isArray(saved.users) ? saved.users.filter(user =>
      user && typeof user.id === "string" && typeof user.email === "string" &&
      typeof user.passwordHash === "string" && typeof user.name === "string"
    ) : [];
    state.currentUserId = typeof saved.currentUserId === "string" && state.users.some(user => user.id === saved.currentUserId)
      ? saved.currentUserId : null;
    state.bookings = saved.bookings.filter(item =>
      item && typeof item.id === "string" && typeof item.spotId === "string" &&
      ["active", "cancelled"].includes(item.status) && Number.isFinite(item.total)
    ).map(item => ({
      ...item,
      // Older demo bookings predate account support and remain unassigned.
      userId: typeof item.userId === "string" ? item.userId : null,
      startDate: item.startDate || state.startDate,
      endDate: item.endDate || state.endDate
    }));
    state.spots = initialSpots.map(spot => ({ ...spot }));
  } catch (error) {
    state.storageMessage = "Не удалось прочитать сохранённые данные. Демо запущено с исходным состоянием.";
    state.storageAvailable = false;
    state.bookings = [];
    state.spots = initialSpots.map(spot => ({ ...spot }));
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 2,
      users: state.users.map(user => ({ ...user })),
      currentUserId: state.currentUserId,
      bookings: state.bookings.map(booking => ({ ...booking }))
    }));
    state.storageAvailable = true;
    state.storageMessage = "";
    renderStorageMessage();
    return true;
  } catch (error) {
    state.storageAvailable = false;
    state.storageMessage = "Браузер не разрешил сохранить данные. Изменения могут пропасть после обновления страницы.";
    renderStorageMessage();
    return false;
  }
}

function renderStorageMessage() {
  storageMessage.hidden = !state.storageMessage;
  storageMessage.textContent = state.storageMessage;
}

function visibleSpots() {
  return state.spots.filter(spot => spot.capacity >= state.filterGuests && spot.pricePerNight >= state.minPrice && spot.pricePerNight <= state.maxPrice);
}

function selectSpot(id) {
  const spot = getSpot(id);
  if (!spot || isOccupied(spot)) {
    announce("Этот участок уже занят. Выбери другое место.");
    return;
  }
  state.selectedId = id;
  state.guests = Math.min(Math.max(1, state.guests), spot.capacity);
  guestsInput.value = String(state.guests);
  clearErrors();
  render();
}

function renderMap() {
  mapSpots.replaceChildren();
  const visible = visibleSpots();
  for (const spot of visible) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-spot";
    button.style.left = `${spot.x}%`;
    button.style.top = `${spot.y}%`;
    button.textContent = spot.id;
    button.setAttribute("aria-label", `${spot.name}, ${isOccupied(spot) ? "занято" : state.selectedId === spot.id ? "выбрано" : "свободно"}, ${formatMoney(spot.pricePerNight)} за ночь, до ${spot.capacity} гостей`);
    if (isOccupied(spot)) {
      button.classList.add("is-occupied");
      button.disabled = true;
      button.title = `${spot.name} — занято`;
    } else {
      button.title = `${spot.name} — ${formatMoney(spot.pricePerNight)} за ночь`;
      button.addEventListener("click", () => selectSpot(spot.id));
      if (state.selectedId === spot.id) button.classList.add("is-selected");
    }
    mapSpots.append(button);
  }
}

function makeSpotCard(spot) {
  const occupied = isOccupied(spot);
  const card = document.createElement("article");
  card.className = `spot-card${state.selectedId === spot.id ? " selected" : ""}${occupied ? " occupied" : ""}`;
  card.tabIndex = occupied ? -1 : 0;
  card.setAttribute("aria-label", `${spot.name}. ${occupied ? "Занято" : "Свободно"}. ${formatMoney(spot.pricePerNight)} за ночь. Вместимость: ${spot.capacity} гостей.`);
  if (!occupied) {
    card.setAttribute("role", "button");
    card.setAttribute("aria-pressed", String(state.selectedId === spot.id));
    card.addEventListener("click", () => selectSpot(spot.id));
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectSpot(spot.id);
      }
    });
  }
  const thumb = document.createElement("div");
  thumb.className = `spot-thumb ${spot.area}`;
  thumb.setAttribute("aria-hidden", "true");
  const tent = document.createElement("span");
  tent.className = "tiny-tent";
  thumb.append(tent);
  const info = document.createElement("div");
  info.className = "spot-info";
  const title = document.createElement("h4");
  title.textContent = spot.name;
  const desc = document.createElement("p");
  desc.textContent = spot.description;
  const meta = document.createElement("div");
  meta.className = "spot-meta";
  meta.innerHTML = `<span>♙ До ${spot.capacity} гостей</span><span class="status-label${occupied ? " occupied-label" : ""}">${occupied ? "ЗАНЯТО" : state.selectedId === spot.id ? "ВЫБРАНО" : "СВОБОДНО"}</span>`;
  info.append(title, desc, meta);
  const price = document.createElement("div");
  price.className = "spot-price";
  price.textContent = formatMoney(spot.pricePerNight);
  const small = document.createElement("small");
  small.textContent = "/ ночь";
  price.append(small);
  card.append(thumb, info, price);
  return card;
}

function renderList() {
  const visible = visibleSpots();
  spotList.replaceChildren();
  visible.forEach(spot => spotList.append(makeSpotCard(spot)));
  resultCount.textContent = `${visible.length} ${visible.length === 1 ? "место" : visible.length < 5 ? "места" : "мест"}`;
  emptyState.hidden = visible.length > 0;
  const noAvailable = visible.length > 0 && visible.every(isOccupied);
  const availabilityEmpty = $("#availability-empty");
  availabilityEmpty.hidden = !noAvailable;
  if (noAvailable) {
    availabilityEmpty.querySelector("p").textContent = `На период ${formatDate(state.startDate)} — ${formatDate(state.endDate)} все подходящие участки заняты. Попробуй изменить даты заезда и выезда.`;
  }
}

function renderSelectedCard() {
  const spot = getSpot(state.selectedId);
  if (!spot || isOccupied(spot)) {
    if (spot && isOccupied(spot)) state.selectedId = null;
    selectedCard.innerHTML = `<div class="selection-placeholder"><div class="placeholder-icon">⌖</div><h3>Сначала выбери место</h3><p>На карте или в списке выше. Здесь появятся описание участка, вместимость и стоимость.</p><a href="#places" class="button button-primary">К выбору мест ↑</a></div>`;
    totalPrice.innerHTML = "— <small>₽</small>";
    priceBreakdown.textContent = "Выбери свободный участок, чтобы рассчитать стоимость.";
    confirmButton.disabled = false;
    return;
  }
  selectedCard.innerHTML = "";
  const visual = document.createElement("div");
  visual.className = `selected-visual ${spot.area}`;
  visual.setAttribute("aria-hidden", "true");
  visual.innerHTML = `<span class="selected-sun"></span><span class="selected-tent"></span>`;
  const copy = document.createElement("div");
  copy.className = "selected-copy";
  const topline = document.createElement("div");
  topline.className = "selected-topline";
  const title = document.createElement("h3");
  title.textContent = spot.name;
  const price = document.createElement("div");
  price.className = "selected-price";
  price.textContent = formatMoney(spot.pricePerNight);
  const perNight = document.createElement("small");
  perNight.textContent = " / ночь";
  price.append(perNight);
  topline.append(title, price);
  const description = document.createElement("p");
  description.textContent = spot.description;
  const chips = document.createElement("div");
  chips.className = "feature-chips";
  [`До ${spot.capacity} гостей`, ...spot.features].forEach(feature => {
    const chip = document.createElement("span");
    chip.className = "feature-chip";
    chip.textContent = feature;
    chips.append(chip);
  });
  copy.append(topline, description, chips);
  selectedCard.append(visual, copy);
  guestsInput.max = String(spot.capacity);
  guestsInput.value = String(state.guests);
  updatePrice();
}

function validate() {
  const spot = getSpot(state.selectedId);
  const guests = Number(guestsInput.value);
  const nights = Number(nightsInput.value);
  let valid = true;
  $("#guests-error").textContent = "";
  $("#nights-error").textContent = "";
  guestsInput.classList.remove("invalid-input");
  nightsInput.classList.remove("invalid-input");
  if (!spot || isOccupied(spot)) {
    formMessage.textContent = "Сначала выбери свободный участок на карте или в списке.";
    return false;
  }
  if (!Number.isInteger(guests) || guests < 1 || guests > spot.capacity) {
    $("#guests-error").textContent = `Укажи целое число от 1 до ${spot.capacity}.`;
    guestsInput.classList.add("invalid-input");
    valid = false;
  }
  if (!Number.isInteger(nights) || nights < 1 || nights > 30) {
    $("#nights-error").textContent = "Укажи целое число ночей от 1 до 30.";
    nightsInput.classList.add("invalid-input");
    valid = false;
  }
  if (!valid) formMessage.textContent = "Проверь значения в отмеченных полях.";
  else formMessage.textContent = "";
  return valid;
}

function clearErrors() {
  $("#guests-error").textContent = "";
  $("#nights-error").textContent = "";
  guestsInput.classList.remove("invalid-input");
  nightsInput.classList.remove("invalid-input");
  formMessage.textContent = "";
}

function updatePrice() {
  const spot = getSpot(state.selectedId);
  const guests = Number(guestsInput.value);
  const nights = Number(nightsInput.value);
  const valid = spot && !isOccupied(spot) && Number.isInteger(guests) && guests >= 1 && guests <= spot.capacity && Number.isInteger(nights) && nights >= 1 && nights <= 30;
  if (!spot || isOccupied(spot)) {
    totalPrice.innerHTML = "— <small>₽</small>";
    priceBreakdown.textContent = "Выбери свободный участок, чтобы рассчитать стоимость.";
    confirmButton.disabled = false;
    return;
  }
  if (!valid) {
    totalPrice.innerHTML = "— <small>₽</small>";
    priceBreakdown.textContent = "Проверь количество гостей и ночей.";
    // Keep the button available so submit can show field-level validation errors.
    confirmButton.disabled = false;
    return;
  }
  const total = spot.pricePerNight * nights;
  totalPrice.innerHTML = `${new Intl.NumberFormat("ru-RU").format(total)} <small>₽</small>`;
  priceBreakdown.textContent = `${formatMoney(spot.pricePerNight)} × ${nights} ${nightsWord(nights)} · ${guests} ${guestsWord(guests)}`;
  confirmButton.disabled = false;
}

function nightsWord(value) {
  const n = value % 100;
  if (n >= 11 && n <= 14) return "ночей";
  if (value % 10 === 1) return "ночь";
  if (value % 10 >= 2 && value % 10 <= 4) return "ночи";
  return "ночей";
}
function guestsWord(value) {
  if (value === 1) return "гость";
  if (value >= 2 && value <= 4) return "гостя";
  return "гостей";
}

function renderBookings() {
  bookingsList.replaceChildren();
  const active = state.currentUserId
    ? state.bookings.filter(booking => booking.status === "active" && booking.userId === state.currentUserId)
    : [];
  bookingsEmpty.hidden = active.length > 0;
  if (!state.currentUserId) {
    bookingsEmpty.querySelector("strong").textContent = "Войди, чтобы увидеть свои брони";
    bookingsEmpty.querySelector("p").textContent = "Создай аккаунт или войди — тогда здесь появятся твои бронирования.";
  } else {
    bookingsEmpty.querySelector("strong").textContent = "Пока нет ни одной брони";
    bookingsEmpty.querySelector("p").textContent = "Самое время выбрать место для своего приключения.";
  }
  for (const booking of [...active].reverse()) {
    const card = document.createElement("article");
    card.className = "booking-item";
    const icon = document.createElement("div");
    icon.className = "booking-item-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "⌂";
    const details = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = booking.spotName;
    const summary = document.createElement("p");
    summary.textContent = `Бронь № ${booking.id} · ${booking.guests} ${guestsWord(booking.guests)} · ${booking.nights} ${nightsWord(booking.nights)}`;
    const dates = document.createElement("p");
    dates.textContent = booking.startDate && booking.endDate
      ? `${formatDate(booking.startDate)} — ${formatDate(booking.endDate)} · ${formatMoney(booking.pricePerNight)} за ночь`
      : `Цена за ночь: ${formatMoney(booking.pricePerNight)}`;
    const amount = document.createElement("div");
    amount.className = "booking-amount";
    amount.textContent = formatMoney(booking.total);
    details.append(title, summary, dates, amount);
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Отменить бронь";
    cancel.addEventListener("click", () => openDialog("Отменить бронирование?", `Бронь № ${booking.id} на участок «${booking.spotName}» будет отменена. Участок снова станет доступен.`, () => cancelBooking(booking.id)));
    card.append(icon, details, cancel);
    bookingsList.append(card);
  }
}

function createBooking() {
  if (!validate()) return;
  const spot = getSpot(state.selectedId);
  if (!spot || isOccupied(spot)) {
    formMessage.textContent = "Этот участок уже занят. Выбери другое место.";
    render();
    return;
  }
  const booking = {
    id: `CT-${Date.now().toString().slice(-7)}`,
    spotId: spot.id,
    spotName: spot.name,
    guests: Number(guestsInput.value),
    nights: Number(nightsInput.value),
    startDate: state.startDate,
    endDate: state.endDate,
    pricePerNight: spot.pricePerNight,
    total: spot.pricePerNight * Number(nightsInput.value),
    status: "active",
    userId: state.currentUserId,
    createdAt: new Date().toISOString()
  };
  state.bookings.push(booking);
  state.selectedId = null;
  const saved = saveData();
  render();
  announce(saved ? `Бронь № ${booking.id} сохранена в этом браузере.` : "Бронь создана до закрытия страницы, но сохранить её не удалось.");
  $("#my-bookings").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelBooking(id) {
  const booking = state.bookings.find(item => item.id === id && item.status === "active" && item.userId === state.currentUserId);
  if (!booking) return;
  booking.status = "cancelled";
  saveData();
  render();
  announce("Бронь отменена. Участок снова свободен.");
}

function openDialog(title, text, action) {
  $("#dialog-title").textContent = title;
  $("#dialog-text").textContent = text;
  pendingAction = action;
  $("#dialog-confirm").textContent = title.startsWith("Сбросить") ? "Да, сбросить" : title.startsWith("Отменить") ? "Да, отменить" : "Да, подтверждаю";
  dialog.showModal();
}
function closeDialog() { dialog.close(); pendingAction = null; }

function renderSelectionCta() {
  const spot = getSpot(state.selectedId);
  if (!spot || isOccupied(spot)) {
    selectionCta.hidden = true;
    return;
  }
  selectionCta.hidden = false;
  selectionCtaTitle.textContent = `${spot.name} выбрано!`;
  selectionCtaText.textContent = `${formatMoney(spot.pricePerNight)} за ночь · ${formatDate(state.startDate)} — ${formatDate(state.endDate)} · до ${spot.capacity} гостей.`;
}

function setupCursorTrail() {
  if (window.matchMedia("(hover: none), (max-width: 640px), (prefers-reduced-motion: reduce)").matches) return;
  const trail = document.createElement("span");
  trail.className = "cursor-trail";
  trail.setAttribute("aria-hidden", "true");
  document.body.append(trail);
  window.addEventListener("pointermove", event => {
    trail.style.left = `${event.clientX}px`;
    trail.style.top = `${event.clientY}px`;
    trail.classList.add("visible");
  }, { passive: true });
  window.addEventListener("pointerleave", () => trail.classList.remove("visible"));
}

function currentUser() {
  return state.users.find(user => user.id === state.currentUserId) || null;
}

function renderAccountStatus() {
  const user = currentUser();
  const button = $("#account-button");
  const status = $("#account-status");
  if (user) {
    button.textContent = `Привет, ${user.name.split(" ")[0]} · аккаунт`;
    status.textContent = `Ты вошёл как ${user.email}. Новые брони будут сохранены в этом аккаунте.`;
  } else {
    button.textContent = "Войти / регистрация";
    status.textContent = "Чтобы оформить бронь, создай аккаунт или войди.";
  }
  $("#account-logout").hidden = !user;
}

function openAccountDialog(mode = "register") {
  authMode = mode;
  updateAuthMode();
  $("#auth-feedback").textContent = "";
  for (const el of document.querySelectorAll(".auth-error")) el.textContent = "";
  $("#account-dialog").showModal();
}

function updateAuthMode() {
  const registering = authMode === "register";
  const profile = authMode === "profile";
  $("#register-form").hidden = !registering;
  $("#login-form").hidden = registering || profile;
  $("#show-register").hidden = profile;
  $("#show-login").hidden = profile;
  $(".auth-tabs").hidden = profile;
  $("#account-logout").hidden = !profile;
  $("#show-register").classList.toggle("active", registering);
  $("#show-login").classList.toggle("active", !registering && !profile);
  const user = currentUser();
  $("#account-dialog-title").textContent = profile ? `Ты вошёл как ${user?.name || "пользователь"}` : registering ? "Создай свой аккаунт" : "С возвращением!";
  $("#account-dialog-description").textContent = profile
    ? `${user?.email || ""}. Твои брони привязаны к этому аккаунту в текущем браузере.`
    : registering
      ? "Укажи имя, электронную почту и пароль, чтобы привязать брони к профилю."
      : "Войди с почтой и паролем, которые использовал при регистрации в этом браузере.";
}

async function hashPassword(password) {
  // This is a demo-only local hash, not a substitute for server-side authentication.
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(password);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  // Fallback for local previews where Web Crypto is unavailable.
  let hash = 2166136261;
  for (let i = 0; i < password.length; i += 1) hash = Math.imul(hash ^ password.charCodeAt(i), 16777619);
  return `demo-${(hash >>> 0).toString(16)}`;
}

function finishAuthentication(user, message) {
  state.currentUserId = user.id;
  const saved = saveData();
  $("#account-dialog").close();
  render();
  announce(saved ? message : "Вход выполнен, но браузер не смог сохранить профиль. Данные могут пропасть после обновления.");
  if (pendingBookingAfterAuth) {
    pendingBookingAfterAuth = false;
    requestBookingConfirmation();
  }
}

$("#account-button").addEventListener("click", () => openAccountDialog(currentUser() ? "profile" : "register"));
$("#show-register").addEventListener("click", () => { authMode = "register"; updateAuthMode(); $("#auth-feedback").textContent = ""; });
$("#show-login").addEventListener("click", () => { authMode = "login"; updateAuthMode(); $("#auth-feedback").textContent = ""; });
$("#account-dialog-close").addEventListener("click", () => { $("#account-dialog").close(); pendingBookingAfterAuth = false; });
$("#account-dialog").addEventListener("cancel", () => { pendingBookingAfterAuth = false; });
$("#account-logout").addEventListener("click", () => {
  state.currentUserId = null;
  saveData();
  $("#account-dialog").close();
  pendingBookingAfterAuth = false;
  render();
  announce("Ты вышел из аккаунта. Брони сохранены в браузере и будут доступны после повторного входа.");
});
$("#register-form").addEventListener("submit", async event => {
  event.preventDefault();
  const name = $("#register-name").value.trim();
  const email = $("#register-email").value.trim().toLowerCase();
  const password = $("#register-password").value;
  const errors = { name: "", email: "", password: "" };
  if (name.length < 2) errors.name = "Укажи имя не короче двух символов.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Проверь адрес электронной почты.";
  if (password.length < 6) errors.password = "Пароль должен содержать минимум 6 символов.";
  if (state.users.some(user => user.email === email)) errors.email = "Аккаунт с такой почтой уже существует. Войди вместо регистрации.";
  $("#register-name-error").textContent = errors.name;
  $("#register-email-error").textContent = errors.email;
  $("#register-password-error").textContent = errors.password;
  if (Object.values(errors).some(Boolean)) return;
  try {
    const user = { id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, email, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
    state.users.push(user);
    // Preserve older bookings by attaching them to the first account created in this browser.
    if (state.users.length === 1) {
      state.bookings.forEach(booking => { if (!booking.userId) booking.userId = user.id; });
    }
    finishAuthentication(user, "Аккаунт создан! Теперь можно оформить бронь.");
  } catch (error) {
    $("#auth-feedback").textContent = "Не удалось создать аккаунт. Попробуй ещё раз.";
  }
});
$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const email = $("#login-email").value.trim().toLowerCase();
  const password = $("#login-password").value;
  $("#login-email-error").textContent = "";
  $("#login-password-error").textContent = "";
  const user = state.users.find(item => item.email === email);
  if (!user) {
    $("#login-email-error").textContent = "Аккаунт с такой почтой не найден в этом браузере.";
    return;
  }
  try {
    const hash = await hashPassword(password);
    if (hash !== user.passwordHash) {
      $("#login-password-error").textContent = "Неверный пароль.";
      return;
    }
    finishAuthentication(user, `С возвращением, ${user.name}!`);
  } catch (error) {
    $("#auth-feedback").textContent = "Не удалось выполнить вход. Попробуй ещё раз.";
  }
});

function createStarfield() {
  const layer = $("#starfield");
  if (!layer || layer.childElementCount) return;
  const symbols = ["✦", "✧", "✳", "⋆", "·"];
  for (let i = 0; i < 18; i += 1) {
    const star = document.createElement("span");
    star.className = "field-star";
    star.textContent = symbols[i % symbols.length];
    const edge = 1.1 + (i % 4) * 0.65;
    if (i % 2 === 0) star.style.left = `${edge}%`;
    else star.style.right = `${edge}%`;
    star.style.top = `${(i * 37 + (i % 5) * 13) % 94 + 3}%`;
    star.style.setProperty("--star-delay", `${-((i * 0.37) % 5)}s`);
    star.style.setProperty("--star-duration", `${2.1 + (i % 5) * 0.65}s`);
    star.style.setProperty("--star-size", `${9 + (i % 4) * 4}px`);
    layer.append(star);
  }
}

function render() {
  renderMap();
  renderList();
  renderSelectedCard();
  renderSelectionCta();
  renderBookings();
  renderAccountStatus();
  renderStorageMessage();
  updatePrice();
}

$("#guests-filter").addEventListener("change", event => {
  state.filterGuests = Number(event.target.value);
  if (state.selectedId && !visibleSpots().some(spot => spot.id === state.selectedId)) {
    state.selectedId = null;
    announce("Выбранное место скрыто фильтром. Выбери другое или измени фильтры.");
  }
  render();
});
function updatePriceFilters(changed) {
  const minInput = $("#price-min-filter");
  const maxInput = $("#price-filter");
  state.minPrice = Number(minInput.value);
  state.maxPrice = Number(maxInput.value);
  if (state.minPrice > state.maxPrice) {
    if (changed === "min") {
      state.maxPrice = state.minPrice;
      maxInput.value = String(state.maxPrice);
    } else {
      state.minPrice = state.maxPrice;
      minInput.value = String(state.minPrice);
    }
  }
  $("#price-min-output").textContent = formatMoney(state.minPrice);
  $("#price-output").textContent = formatMoney(state.maxPrice);
  if (state.selectedId && !visibleSpots().some(spot => spot.id === state.selectedId)) {
    state.selectedId = null;
    announce("Выбранное место скрыто фильтром. Выбери другое или измени фильтры.");
  }
  render();
}
$("#price-min-filter").addEventListener("input", () => updatePriceFilters("min"));
$("#price-filter").addEventListener("input", () => updatePriceFilters("max"));
$("#reset-filters").addEventListener("click", () => {
  state.filterGuests = 1;
  state.minPrice = 800;
  state.maxPrice = 3000;
  $("#guests-filter").value = "1";
  $("#price-min-filter").value = "800";
  $("#price-filter").value = "3000";
  $("#price-min-output").textContent = formatMoney(800);
  $("#price-output").textContent = formatMoney(3000);
  $("#check-in-filter").value = state.startDate;
  $("#check-out-filter").value = state.endDate;
  render();
});
guestsInput.addEventListener("input", () => {
  clearErrors();
  updatePrice();
});
nightsInput.addEventListener("input", () => {
  const value = Number(nightsInput.value);
  if (Number.isInteger(value) && value >= 1 && value <= 30) {
    state.nights = value;
    state.endDate = addDaysToISO(state.startDate, value);
    $("#check-out-filter").value = state.endDate;
    $("#check-out-filter").min = addDaysToISO(state.startDate, 1);
    $("#check-out-filter").max = addDaysToISO(state.startDate, 30);
    render();
  } else {
    clearErrors();
    updatePrice();
  }
});
function updateDateRange(changed) {
  const arrival = $("#check-in-filter");
  const departure = $("#check-out-filter");
  const today = isoDateWithOffset(0);
  arrival.min = today;
  if (!arrival.value || arrival.value < today) arrival.value = today;
  departure.min = addDaysToISO(arrival.value, 1);
  departure.max = addDaysToISO(arrival.value, 30);
  if (!departure.value || departure.value <= arrival.value) {
    departure.value = addDaysToISO(arrival.value, 1);
  }
  if (departure.value > departure.max) departure.value = departure.max;
  state.startDate = arrival.value;
  state.endDate = departure.value;
  state.nights = Math.max(1, daysBetween(state.startDate, state.endDate));
  nightsInput.value = String(state.nights);
  nightsInput.max = "30";
  clearErrors();
  if (state.selectedId && isOccupied(getSpot(state.selectedId))) {
    state.selectedId = null;
    announce("Это место занято на выбранные даты. Выбери другой участок или измени период.");
  }
  render();
}
$("#check-in-filter").value = state.startDate;
$("#check-out-filter").value = state.endDate;
$("#check-in-filter").min = isoDateWithOffset(0);
$("#check-out-filter").min = addDaysToISO(state.startDate, 1);
$("#check-out-filter").max = addDaysToISO(state.startDate, 30);
$("#check-in-filter").addEventListener("change", () => updateDateRange("arrival"));
$("#check-out-filter").addEventListener("change", () => updateDateRange("departure"));
function changeNumber(input, delta, min, max) {
  const current = Number(input.value);
  const safeCurrent = Number.isFinite(current) && current >= min ? current : min;
  input.value = String(Math.min(max, Math.max(min, safeCurrent + delta)));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
$("#guest-minus").addEventListener("click", () => { changeNumber(guestsInput, -1, 1, Number(guestsInput.max || 8)); });
$("#guest-plus").addEventListener("click", () => { const spot = getSpot(state.selectedId); changeNumber(guestsInput, 1, 1, spot?.capacity || 8); });
$("#night-minus").addEventListener("click", () => changeNumber(nightsInput, -1, 1, 30));
$("#night-plus").addEventListener("click", () => changeNumber(nightsInput, 1, 1, 30));

function requestBookingConfirmation() {
  if (!validate()) return;
  if (!state.currentUserId) {
    pendingBookingAfterAuth = true;
    openAccountDialog("register");
    $("#auth-feedback").textContent = "Сначала создай аккаунт или войди, чтобы привязать бронь к профилю.";
    return;
  }
  const spot = getSpot(state.selectedId);
  const nights = Number(nightsInput.value);
  const guests = Number(guestsInput.value);
  openDialog("Подтвердить бронь?", `«${spot.name}» · ${guests} ${guestsWord(guests)} · ${nights} ${nightsWord(nights)} · итого ${formatMoney(spot.pricePerNight * nights)}. Бронь будет сохранена в аккаунте ${currentUser()?.name || "пользователя"}. Это учебная бронь, реальная оплата не производится.`, createBooking);
}
$("#booking-form").addEventListener("submit", event => {
  event.preventDefault();
  requestBookingConfirmation();
});
$("#dialog-cancel").addEventListener("click", closeDialog);
$("#dialog-confirm").addEventListener("click", () => {
  const action = pendingAction;
  closeDialog();
  if (action) action();
});
dialog.addEventListener("click", event => {
  if (event.target === dialog) closeDialog();
});
$("#reset-demo").addEventListener("click", () => {
  openDialog("Сбросить демо-данные?", "Все сохранённые учебные брони будут удалены, а занятость вернётся к исходному состоянию. Это действие нельзя отменить.", () => {
    state.bookings = [];
    state.spots = initialSpots.map(spot => ({ ...spot }));
    state.selectedId = null;
    saveData();
    render();
    announce("Демо сброшено. Исходные данные восстановлены.");
  });
});

createStarfield();
setupCursorTrail();
loadSavedData();
$("#price-min-output").textContent = formatMoney(state.minPrice);
$("#price-output").textContent = formatMoney(state.maxPrice);
render();
