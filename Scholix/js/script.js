const header = document.querySelector("#siteHeader");
const navToggle = document.querySelector("#navToggle");
const nav = document.querySelector("#primaryNav");

function syncHeader() {
  header.classList.toggle("is-scrolled", window.scrollY > 12);
}

syncHeader();
window.addEventListener("scroll", syncHeader, { passive: true });

if (navToggle && nav) {
  navToggle.addEventListener("click", () => {
    const open = navToggle.getAttribute("aria-expanded") === "true";
    navToggle.setAttribute("aria-expanded", String(!open));
    navToggle.setAttribute("aria-label", open ? "Open navigation menu" : "Close navigation menu");
    nav.classList.toggle("is-open", !open);
  });

  nav.addEventListener("click", (event) => {
    if (event.target.tagName === "A") {
      nav.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  });
}

const storyCards = [...document.querySelectorAll("#stories .quote")];
const storyPrev = document.querySelector("[data-story-prev]");
const storyNext = document.querySelector("[data-story-next]");
const storyStatus = document.querySelector(".stories-carousel__status");
let activeStory = 0;

function showStory(index) {
  if (!storyCards.length) return;
  activeStory = (index + storyCards.length) % storyCards.length;
  const mobile = window.matchMedia("(max-width: 700px)").matches;
  storyCards.forEach((card, i) => {
    card.classList.toggle("is-active", i === activeStory);
    if (mobile) card.setAttribute("aria-hidden", String(i !== activeStory));
    else card.removeAttribute("aria-hidden");
  });
  if (storyStatus) storyStatus.textContent = `${activeStory + 1} / ${storyCards.length}`;
}

if (storyCards.length && storyPrev && storyNext) {
  storyPrev.addEventListener("click", () => showStory(activeStory - 1));
  storyNext.addEventListener("click", () => showStory(activeStory + 1));
  window.addEventListener("resize", () => showStory(activeStory), { passive: true });
  showStory(activeStory);
}
const year = document.querySelector("#year");
if (year) year.textContent = String(new Date().getFullYear());
