// WhatsApp click-to-chat link that actually opens the app on phones.
//
// The https endpoints (wa.me / api.whatsapp.com/send) bounce mobile users
// through a web interstitial page first — and inside a standalone PWA or
// an in-app browser that interstitial frequently dead-ends as a blank
// page (reported live from the Contact Lab action on iPhone). The
// whatsapp:// app scheme skips the web hop entirely and opens the chat
// directly, so phones get the scheme and desktops keep the https URL
// (where the scheme would error without the desktop app installed).
const MOBILE_UA = /iPhone|iPad|iPod|Android/i;

export function waLink(phone, text) {
  const encoded = encodeURIComponent(text);
  if (MOBILE_UA.test(navigator.userAgent)) {
    return phone ? `whatsapp://send?phone=${phone}&text=${encoded}` : `whatsapp://send?text=${encoded}`;
  }
  return phone
    ? `https://api.whatsapp.com/send?phone=${phone}&text=${encoded}`
    : `https://api.whatsapp.com/send?text=${encoded}`;
}
