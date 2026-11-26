// The live shell has no preview marker. The local launcher supplies it on loopback.
const LOCAL_PREVIEW = document.querySelector('meta[name="pbc-local-preview"]')?.content === "1" &&
  location.protocol === "http:" && ["127.0.0.1", "localhost"].includes(location.hostname);
