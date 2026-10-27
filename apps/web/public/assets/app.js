const number = new Intl.NumberFormat("en-GB");

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

fetch("/api/v1/stats")
  .then((response) => (response.ok ? response.json() : Promise.reject(new Error("stats"))))
  .then((stats) => {
    for (const element of document.querySelectorAll("[data-stat]")) {
      const key = element.dataset.stat;
      if (key && key in stats) {
        element.textContent = key === "last_observation" ? stats[key] ?? "—" : number.format(stats[key]);
      }
    }
    setText("[data-status]", "live");
  })
  .catch(() => {
    setText("[data-status]", "api unavailable");
  });

fetch("/api/v1/healthz")
  .then((response) => (response.ok ? response.json() : Promise.reject(new Error("health"))))
  .then((health) => {
    setText("[data-version]", `v${health.version}`);
  })
  .catch(() => {});
