/* ============================================================
   nav.js — comportements communs à toutes les pages :
   - menu burger sur mobile
   - repli du panneau de filtres sur les pages carte (mobile)
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  // --- Menu burger (mobile) ---
  const toggle = document.querySelector(".nav-toggle");
  const liens = document.querySelector(".nav-links");

  if (toggle && liens) {
    toggle.addEventListener("click", () => {
      const ouvert = liens.classList.toggle("ouvert");
      toggle.setAttribute("aria-expanded", ouvert ? "true" : "false");
    });
  }

  // --- Repli du panneau de filtres (pages carte, mobile) ---
  const sidebar = document.querySelector(".sidebar");
  const sidebarToggle = document.querySelector(".sidebar-toggle");

  if (sidebar && sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      const replie = sidebar.classList.toggle("replie");
      sidebarToggle.textContent = replie
        ? "🔽 Afficher les filtres"
        : "🔼 Masquer les filtres";
    });
  }
});
