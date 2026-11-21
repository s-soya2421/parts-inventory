import { secureHeaders } from "hono/secure-headers";

export const applySecurityHeaders = secureHeaders({
  xFrameOptions: "DENY",
  // no-referrer makes Origin null on POST form navigations, including logout.
  referrerPolicy: "same-origin",
  strictTransportSecurity: "max-age=31536000",
  crossOriginResourcePolicy: "same-origin",
  permissionsPolicy: {
    camera: [], geolocation: [], microphone: [], payment: [], usb: [],
  },
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
  },
});
