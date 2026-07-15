/**
 * Editable invitation content.
 *
 * Keep presentation and interaction logic out of this file. Text containing
 * multiple visual lines is represented as an array so the renderer can add
 * line breaks without embedding HTML in the content.
 */
export const INVITATION = Object.freeze({
  couple: "J & C",
  weddingDate: "19.09.2026",
  ceremony: {
    time: "12:00 Uhr",
    venue: "Schlosskapelle",
    addressLines: ["39326 Wolmirstedt"],
    parkingLines: ["Direkt vor Ort"],
  },
  party: {
    time: "14:00 Uhr",
    venue: "Basta Magdeburg",
    addressLines: ["Halberstädter Str. 51,", "39112 Magdeburg"],
    parkingLines: ["Plätze vor Ort", "Alternativ in den", "Nebenstraßen"],
    dressCode: "Black-Tie optional",
    foodLines: [
      "Bitte meldet euch bei",
      "Allergien.",
      "Vegane Optionen sind",
      "vorhanden.",
    ],
  },
  message: {
    salutation: "Liebe Familie, liebe Freunde,",
    paragraphs: [
      "Danke, dass Ihr unseren besonderen Tag mit uns celebriert!",
      "Wir freuen uns riesig auf den Tag und darauf, mit euch zusammen unsere Ehe zu feiern.",
      "Falls Ihr uns darüber hinaus eine Freude bereiten möchtet, würden wir uns über einen Beitrag zu unserer Hochzeitsreise sehr freuen.",
      "Am meisten aber zählt für uns, dass Ihr diesen Tag mit uns teilt.",
    ],
  },
});

/**
 * Public, readable URL paths and the invitation variant they display.
 * Unknown paths continue to show the invitation's error page.
 */
export const INVITATION_ROUTES = Object.freeze({
  "einladung/trauung": "all",
  "einladung/feier": "party",
});
