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
 * SHA-256 digests of the private path tokens.
 *
 * Never commit the original tokens. They are kept locally in the ignored file
 * `invitation-links.private.txt`.
 */
export const ACCESS_CODE_HASHES = Object.freeze({
  "71924b71aaca7612c1d92740044b6290676e9f5d661e93b98bcbebca970534e3":
    "all",
  "7a12560cb8678eabab7f02b5b028efdf3e98f38bc2592a5ff5dc81a98ef9c209":
    "party",
});
