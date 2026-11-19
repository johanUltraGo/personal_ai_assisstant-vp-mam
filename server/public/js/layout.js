// Phone vs laptop layout. Under 768px only one section ("view") shows at a
// time, chosen from the bottom navigation bar; wider screens show everything
// and the same links simply scroll. Without this script every section shows.

const phone = window.matchMedia("(max-width: 767.98px)");
const links = [...document.querySelectorAll(".main-nav a[data-target]")];
const VIEWS = links.map((a) => a.dataset.target);

/** Which view holds the element a link or address points at (#morning-list-section -> today). */
function viewFor(hash) {
  const id = (hash || "").replace(/^#/, "");
  if (VIEWS.includes(id)) return id;
  const el = id ? document.getElementById(id) : null;
  return el?.closest("[data-view]")?.dataset.view ?? "today";
}

function show(view) {
  document.body.dataset.view = view;
  for (const a of links) {
    if (a.dataset.target === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

for (const a of links) {
  a.addEventListener("click", (event) => {
    show(a.dataset.target);
    if (phone.matches) {
      event.preventDefault();
      history.replaceState(null, "", `#${a.dataset.target}`);
      window.scrollTo({ top: 0 });
    }
  });
}

window.addEventListener("hashchange", () => show(viewFor(location.hash)));
show(viewFor(location.hash));
document.documentElement.classList.add("has-views");
