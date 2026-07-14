const INVITATION = {
  couple: "J & C",
  weddingDate: "19.09.2026",
  ceremony: {
    time: "12:15 Uhr",
    venue: "Schlosskapelle",
    address: "39326 Wolmirstedt",
    parking: "Direkt vor Ort",
  },
  party: {
    time: "14:00 Uhr",
    venue: "Basta Magdeburg",
    address: "Halberstädter Str. 51, 39112 Magdeburg",
    parking: "Plätze vor Ort oder in den Nebenstraßen",
    dressCode: "Black Tie optional",
    food: "Bitte meldet euch bei Allergien. Vegane Optionen sind vorhanden.",
  },
};

const cards = {
  ceremony: {
    type: "ceremony",
    title: "Die Trauung",
    label: "Informationen zur Trauung",
    content: `
      <p><strong>Uhrzeit</strong><br>${INVITATION.ceremony.time}</p>
      <address class="address"><strong>Ort</strong><br>${INVITATION.ceremony.venue}<br>${INVITATION.ceremony.address}</address>
      <p><strong>Parken</strong><br>${INVITATION.ceremony.parking}</p>
    `,
  },
  party: {
    type: "party",
    title: "Die Feier",
    label: "Informationen zur Feier",
    content: `
      <p><strong>Uhrzeit</strong><br>${INVITATION.party.time}</p>
      <address class="address"><strong>Ort</strong><br>${INVITATION.party.venue}<br>${INVITATION.party.address}</address>
      <p><strong>Parken</strong><br>${INVITATION.party.parking}</p>
      <p><strong>Dresscode</strong><br>${INVITATION.party.dressCode}</p>
      <p><strong>Verpflegung</strong><br>${INVITATION.party.food}</p>
    `,
  },
  message: {
    type: "message",
    title: "Für euch",
    label: "Persönlicher Einladungstext",
    content: `
      <p class="message-salutation">Liebe Familie, liebe Freunde,</p>
      <p>Danke, dass ihr unseren besonderen Tag mit uns feiert! Wir freuen uns riesig auf den Tag und darauf, mit euch zusammen unsere Ehe zu feiern.</p>
      <p>Falls ihr uns darüber hinaus eine Freude bereiten möchtet, würden wir uns über einen Beitrag zu unserer Hochzeitsreise sehr freuen.</p>
      <p>Am meisten aber zählt für uns, dass ihr diesen Tag mit uns teilt.</p>
    `,
  },
};

const params = new URLSearchParams(window.location.search);
const invitationType = params.get("invite") === "party" ? "party" : "all";
const cardOrder =
  invitationType === "party"
    ? [cards.party, cards.message]
    : [cards.party, cards.ceremony, cards.message];

const book = document.querySelector("#invitationBook");
const cover = document.querySelector("#cover");
const insertStack = document.querySelector("#insertStack");
const pocket = document.querySelector(".pocket");
const hint = document.querySelector("#interactionHint");
const replayButton = document.querySelector("#replayButton");
const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

insertStack.classList.toggle("insert-stack--two", cardOrder.length === 2);

document.querySelectorAll("[data-wedding-date]").forEach((element) => {
  element.textContent = INVITATION.weddingDate;
});

document.title = `${INVITATION.couple} · Hochzeitseinladung`;

cardOrder.forEach((card, index) => {
  const article = document.createElement("article");
  article.className = `insert-card insert-card--${card.type}`;
  article.tabIndex = 0;
  article.setAttribute("role", "button");
  article.setAttribute("aria-label", `${card.label} vollständig anzeigen`);
  article.setAttribute("aria-pressed", "false");
  article.innerHTML = `
    <div class="insert-inner">
      ${
        card.type === "party" || card.type === "ceremony"
          ? '<img class="event-frame-layer" src="assets/party-header-frame.png" alt="" aria-hidden="true">'
          : card.type === "message"
            ? ""
            : '<div class="insert-ornament" aria-hidden="true"></div>'
      }
      <h2 class="insert-kicker">${card.title}</h2>
      <div class="insert-content">${card.content}</div>
      <span class="card-number">0${index + 1}</span>
    </div>
  `;
  insertStack.append(article);
});

const insertCards = [...document.querySelectorAll(".insert-card")];

function setActiveCard(selectedCard) {
  insertCards.forEach((card) => {
    const active =
      card === selectedCard && !card.classList.contains("is-active");
    card.classList.toggle("is-active", active);
    card.setAttribute("aria-pressed", String(active));
  });
}

insertCards.forEach((card) => {
  card.addEventListener("click", (event) => {
    event.stopPropagation();
    setActiveCard(card);
  });

  card.addEventListener("keydown", (event) => {
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

pocket.addEventListener("click", (event) => {
  event.stopPropagation();
});

book.addEventListener("click", () => {
  if (book.classList.contains("is-open")) setActiveCard(null);
});

function openInvitation() {
  book.classList.remove("is-closed");
  book.classList.add("is-open");
  cover.setAttribute("aria-label", "Einladung ist geöffnet");
  hint.textContent = window.matchMedia("(pointer: fine)").matches
    ? "Klicke auf eine Einsteckkarte, um sie herauszuziehen."
    : "Tippe auf eine Einsteckkarte, um sie herauszuziehen.";
  replayButton.hidden = false;
}

function resetInvitation() {
  setActiveCard(null);
  book.classList.remove("is-open");
  book.classList.add("is-closed");
  cover.setAttribute("aria-label", "Einladung öffnen");
  hint.textContent = "Berühre die Karte, um sie zu öffnen.";
  replayButton.hidden = true;
}

cover.addEventListener("click", openInvitation);
replayButton.addEventListener("click", () => {
  resetInvitation();
  // window.setTimeout(openInvitation, reduceMotion ? 20 : 900);
});

// window.setTimeout(openInvitation, reduceMotion ? 40 : 1200);
