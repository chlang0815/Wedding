import { ACCESS_CODE_HASHES, INVITATION } from "./invitation.config.js";

const SELECTORS = Object.freeze({
  experience: ".experience",
  book: "#invitationBook",
  cover: "#cover",
  insertStack: "#insertStack",
  pocket: ".pocket",
  hint: "#interactionHint",
  replayButton: "#replayButton",
});

// ---------------------------------------------------------------------------
// Content rendering
// ---------------------------------------------------------------------------

function renderLines(lines) {
  return lines.join("<br>");
}

function getGoogleMapsUrl(event) {
  const query = encodeURIComponent(
    [event.venue, ...event.addressLines].join(" "),
  );

  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function renderLocation(event) {
  const addressLines = [event.venue, ...event.addressLines]
    .map((line) => `<span class="location-link__line">${line}</span>`)
    .join("");

  return `
    <address class="address">
      <strong>Ort</strong><br>
      <a
        class="location-link"
        href="${getGoogleMapsUrl(event)}"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="${event.venue} in Google Maps öffnen"
      >${addressLines}</a>
    </address>
  `;
}

function renderDetail(label, lines) {
  return `<p><strong>${label}</strong><br>${renderLines(lines)}</p>`;
}

function getCards() {
  const ceremony = INVITATION.ceremony;
  const party = INVITATION.party;

  return {
    ceremony: {
      type: "ceremony",
      title: "Die Trauung",
      label: "Informationen zur Trauung",
      content: [
        renderDetail("Uhrzeit", [ceremony.time]),
        renderLocation(ceremony),
        renderDetail("Parken", ceremony.parkingLines),
      ].join(""),
    },
    party: {
      type: "party",
      title: "Die Feier",
      label: "Informationen zur Feier",
      content: [
        renderDetail("Uhrzeit", [party.time]),
        renderLocation(party),
        renderDetail("Parken", party.parkingLines),
        renderDetail("Dresscode", [party.dressCode]),
        renderDetail("Verpflegung", party.foodLines),
      ].join(""),
    },
    message: {
      type: "message",
      title: "",
      label: "Persönlicher Einladungstext",
      salutation: INVITATION.message.salutation,
      content: INVITATION.message.paragraphs
        .map((paragraph) => `<p>${paragraph}</p>`)
        .join(""),
    },
  };
}

function renderCard(card) {
  const article = document.createElement("article");
  const eventHeader =
    card.type === "party" || card.type === "ceremony"
      ? '<img class="event-frame-layer" src="assets/party-header-frame.png" alt="" aria-hidden="true">'
      : "";
  const title = card.title
    ? `<h2 class="insert-kicker">${card.title}</h2>`
    : "";
  const salutation = card.salutation
    ? `<h2 class="message-salutation">${card.salutation}</h2>`
    : "";

  article.className = `insert-card insert-card--${card.type}`;
  article.tabIndex = 0;
  article.setAttribute("role", "button");
  article.setAttribute("aria-label", `${card.label} vollständig anzeigen`);
  article.setAttribute("aria-pressed", "false");
  article.innerHTML = `
    <div class="insert-inner">
      ${eventHeader}
      ${title}
      ${salutation}
      <div class="insert-content">${card.content}</div>
    </div>
  `;

  return article;
}

// ---------------------------------------------------------------------------
// Private-link routing
// ---------------------------------------------------------------------------

function showAccessError() {
  document.title = "Einladung nicht gefunden";
  document.body.innerHTML = `
    <main class="access-error" aria-labelledby="access-error-title">
      <div class="access-error__card">
        <img
          class="access-error__monogram"
          src="assets/monogram.png"
          alt="Monogramm J und C"
        />
        <h1 id="access-error-title">Einladung nicht gefunden</h1>
      </div>
    </main>
  `;
}

async function getInvitationType() {
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const accessCode = pathParts.at(-1) ?? "";

  if (!accessCode || accessCode.length > 128) return null;

  const encodedCode = new TextEncoder().encode(accessCode);
  const digest = await window.crypto.subtle.digest("SHA-256", encodedCode);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return ACCESS_CODE_HASHES[hash] ?? null;
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function getRequiredElement(selector) {
  const element = document.querySelector(selector);

  if (!element) {
    throw new Error(`Required element not found: ${selector}`);
  }

  return element;
}

function isLinkEvent(event) {
  return event.target instanceof Element && Boolean(event.target.closest("a"));
}

function setupCardInteractions(cards, book) {
  function setActiveCard(selectedCard) {
    cards.forEach((card) => {
      const isActive =
        card === selectedCard && !card.classList.contains("is-active");

      card.classList.toggle("is-active", isActive);
      card.setAttribute("aria-pressed", String(isActive));
    });
  }

  cards.forEach((card) => {
    card.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!isLinkEvent(event)) setActiveCard(card);
    });

    card.addEventListener("keydown", (event) => {
      if (isLinkEvent(event)) return;

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setActiveCard(card);
      }

      if (event.key === "Escape") {
        setActiveCard(null);
        card.blur();
      }
    });
  });

  book.addEventListener("click", () => {
    if (book.classList.contains("is-open")) setActiveCard(null);
  });

  return setActiveCard;
}

function setupBookControls({ book, cover, hint, replayButton, setActiveCard }) {
  function openInvitation() {
    book.classList.remove("is-closed");
    book.classList.add("is-open");
    cover.setAttribute("aria-label", "Einladung ist geöffnet");
    hint.textContent = window.matchMedia("(pointer: fine)").matches
      ? "Klicke auf eine Einsteckkarte, um sie herauszuziehen."
      : "Tippe auf eine Einsteckkarte, um sie herauszuziehen.";
    replayButton.hidden = false;
  }

  function closeInvitation() {
    setActiveCard(null);
    book.classList.remove("is-open");
    book.classList.add("is-closed");
    cover.setAttribute("aria-label", "Einladung öffnen");
    hint.textContent = "Berühre die Karte, um sie zu öffnen.";
    replayButton.hidden = true;
  }

  cover.addEventListener("click", openInvitation);
  replayButton.addEventListener("click", closeInvitation);
}

// ---------------------------------------------------------------------------
// Application bootstrap
// ---------------------------------------------------------------------------

async function initializeInvitation() {
  const invitationType = await getInvitationType();

  if (!invitationType) {
    showAccessError();
    return;
  }

  const elements = Object.fromEntries(
    Object.entries(SELECTORS).map(([name, selector]) => [
      name,
      getRequiredElement(selector),
    ]),
  );
  const cards = getCards();
  const cardOrder =
    invitationType === "party"
      ? [cards.party, cards.message]
      : [cards.party, cards.ceremony, cards.message];

  elements.book.classList.toggle("has-two-cards", cardOrder.length === 2);
  document.querySelectorAll("[data-wedding-date]").forEach((element) => {
    element.textContent = INVITATION.weddingDate;
  });
  document.title = `${INVITATION.couple} · Hochzeitseinladung`;

  cardOrder
    .map(renderCard)
    .forEach((card) => elements.insertStack.append(card));

  const renderedCards = [...document.querySelectorAll(".insert-card")];
  const setActiveCard = setupCardInteractions(renderedCards, elements.book);

  elements.pocket.addEventListener("click", (event) => event.stopPropagation());
  setupBookControls({ ...elements, setActiveCard });
  elements.experience.hidden = false;
}

initializeInvitation().catch((error) => {
  console.error(error);
  showAccessError();
});
