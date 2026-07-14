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
    parking: "Plätze vor Ort<br>Alternativ in den<br>Nebenstraßen",
    dressCode: "Black-Tie optional",
    food: "Bitte meldet euch bei<br>Allergien.<br>Vegane Optionen sind<br>vorhanden.",
  },
};

function getGoogleMapsUrl(venue, address) {
  const query = encodeURIComponent(`${venue}, ${address}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

const cards = {
  ceremony: {
    type: "ceremony",
    title: "Die Trauung",
    label: "Informationen zur Trauung",
    content: `
      <p><strong>Uhrzeit</strong><br>${INVITATION.ceremony.time}</p>
      <p></p>
      <p></p>
      <address class="address"><strong>Ort</strong><br><a class="location-link" href="${getGoogleMapsUrl(INVITATION.ceremony.venue, INVITATION.ceremony.address)}" target="_blank" rel="noopener noreferrer" aria-label="${INVITATION.ceremony.venue} in Google Maps öffnen">${INVITATION.ceremony.venue}<br>${INVITATION.ceremony.address}</a></address>
      <p></p>
      <p></p>
      <p><strong>Parken</strong><br>${INVITATION.ceremony.parking}</p>
    `,
  },
  party: {
    type: "party",
    title: "Die Feier",
    label: "Informationen zur Feier",
    content: `
      <p><strong>Uhrzeit</strong><br>${INVITATION.party.time}</p>
      <p></p>
      <address class="address"><strong>Ort</strong><br><a class="location-link" href="${getGoogleMapsUrl(INVITATION.party.venue, INVITATION.party.address)}" target="_blank" rel="noopener noreferrer" aria-label="${INVITATION.party.venue} in Google Maps öffnen">${INVITATION.party.venue}<br>${INVITATION.party.address}</a></address>
      <p></p>
      <p><strong>Parken</strong><br>${INVITATION.party.parking}</p>
      <p></p>
      <p><strong>Dresscode</strong><br>${INVITATION.party.dressCode}</p>
      <p></p>
      <p><strong>Verpflegung</strong><br>${INVITATION.party.food}</p>
    `,
  },
  message: {
    type: "message",
    title: "",
    label: "Persönlicher Einladungstext",
    content: `
      <p class="message-salutation">Liebe Familie, liebe Freunde,</p>
      <p>Danke, dass Ihr unseren besonderen Tag mit uns celebriert!</p>
      <p>Wir freuen uns riesig auf den Tag und darauf, mit euch zusammen unsere Ehe zu feiern.</p>
      <p>Falls Ihr uns darüber hinaus eine Freude bereiten möchtet, würden wir uns über einen Beitrag zu unserer Hochzeitsreise sehr freuen.</p>
      <p>Am meisten aber zählt für uns, dass Ihr diesen Tag mit uns teilt.</p>
    `,
  },
};

const ACCESS_CODE_HASHES = {
  "71924b71aaca7612c1d92740044b6290676e9f5d661e93b98bcbebca970534e3": "all",
  "7a12560cb8678eabab7f02b5b028efdf3e98f38bc2592a5ff5dc81a98ef9c209": "party",
};

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

async function initializeInvitation() {
  const invitationType = await getInvitationType();

  if (!invitationType) {
    showAccessError();
    return;
  }

  const cardOrder =
    invitationType === "party"
      ? [cards.party, cards.message]
      : [cards.party, cards.ceremony, cards.message];

  const experience = document.querySelector(".experience");
  const book = document.querySelector("#invitationBook");
  const cover = document.querySelector("#cover");
  const insertStack = document.querySelector("#insertStack");
  const pocket = document.querySelector(".pocket");
  const hint = document.querySelector("#interactionHint");
  const replayButton = document.querySelector("#replayButton");

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
      if (event.target.closest("a")) return;
      setActiveCard(card);
    });

    card.addEventListener("keydown", (event) => {
      if (event.target.closest("a")) return;

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
  replayButton.addEventListener("click", resetInvitation);

  experience.hidden = false;
}

initializeInvitation().catch(showAccessError);
