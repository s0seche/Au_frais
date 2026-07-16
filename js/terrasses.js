/* ============================================================
   terrasses.js — logique de la page « Une mousse au frais »
   Même mécanique que la page Carte (Leaflet + géolocalisation +
   Nominatim + Overpass), mais pour les bars, cafés et pubs.
   Les lieux avec terrasse (outdoor_seating=yes) sont mis en avant.

   Comme sur la page Carte : une seule requête Overpass par
   position, déclenchée par l'utilisateur ; les cases à cocher
   filtrent ensuite côté navigateur.
   ============================================================ */

(() => {
  "use strict";

  // ---------- Configuration ----------
  const RAYON_METRES = 2000;
  const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
  const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

  // Types de lieux (tags OSM cachés derrière des libellés simples)
  const TYPES = {
    bar:  { libelle: "Bar",  emoji: "🍸", selecteur: '["amenity"="bar"]' },
    pub:  { libelle: "Pub",  emoji: "🍺", selecteur: '["amenity"="pub"]' },
    cafe: { libelle: "Café", emoji: "☕", selecteur: '["amenity"="cafe"]' },
  };

  // ---------- Éléments du DOM ----------
  const btnLocaliser = document.getElementById("btn-localiser");
  const formRecherche = document.getElementById("form-recherche");
  const champRecherche = document.getElementById("champ-recherche");
  const zoneStatut = document.getElementById("statut");
  const casesLieux = [...document.querySelectorAll(".filtre-lieu")];

  // ---------- Initialisation de la carte ----------
  const carte = L.map("carte").setView([46.6, 2.4], 6); // vue France par défaut

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(carte);

  const coucheMarqueurs = L.layerGroup().addTo(carte);
  const coucheRepere = L.layerGroup().addTo(carte);

  let resultats = []; // derniers lieux renvoyés par Overpass

  // ---------- Messages d'état ----------
  function afficherStatut(html, type = "info") {
    zoneStatut.className = `statut visible ${type}`;
    zoneStatut.innerHTML = html;
  }

  function echapper(texte) {
    const div = document.createElement("div");
    div.textContent = texte;
    return div.innerHTML;
  }

  // Adresse lisible à partir des tags OSM (vide si non renseignée)
  function adresseDe(tags) {
    const rue = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
    const ville = [tags["addr:postcode"], tags["addr:city"]].filter(Boolean).join(" ");
    return [rue, ville].filter(Boolean).join(", ");
  }

  /*
   * Lien Google Maps : nom + adresse quand on les connaît (Google
   * retrouve alors la fiche du lieu), sinon les coordonnées exactes.
   */
  function lienGoogleMaps(lieu) {
    const cible =
      lieu.nom !== "Nom inconnu" && lieu.adresse
        ? `${lieu.nom}, ${lieu.adresse}`
        : `${lieu.lat},${lieu.lon}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cible)}`;
  }

  // Re-filtrer l'affichage dès qu'une case change
  casesLieux.forEach((c) => c.addEventListener("change", afficherMarqueurs));

  // ---------- Affichage des marqueurs ----------
  function afficherMarqueurs() {
    coucheMarqueurs.clearLayers();
    const typesCoches = casesLieux.filter((c) => c.checked).map((c) => c.value);

    let visibles = 0;
    for (const lieu of resultats) {
      if (!typesCoches.includes(lieu.type)) continue;

      // Vert menthe = terrasse confirmée, bleu = terrasse non renseignée
      const classe = lieu.terrasse ? "terrasse" : "interieur";
      const icone = L.divIcon({
        className: "",
        html: `<div class="marqueur ${classe}">${lieu.emoji}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 28],
        popupAnchor: [0, -26],
      });

      const badge = lieu.terrasse
        ? '<br><span class="popup-badge">🌿 Terrasse</span>'
        : "";

      const adresseHtml = lieu.adresse
        ? `<div class="popup-adresse">📮 ${echapper(lieu.adresse)}</div>`
        : "";

      L.marker([lieu.lat, lieu.lon], { icon: icone })
        .bindPopup(
          `<div class="popup-nom">${echapper(lieu.nom)}</div>` +
          `<div class="popup-type">${lieu.emoji} ${lieu.libelle}${badge}</div>` +
          adresseHtml +
          `<a class="popup-lien" href="${lienGoogleMaps(lieu)}" target="_blank" rel="noopener">Voir sur Google Maps ↗</a>`
        )
        .addTo(coucheMarqueurs);
      visibles++;
    }

    if (resultats.length > 0) {
      afficherStatut(
        visibles > 0
          ? `🍻 <strong>${visibles}</strong> adresse${visibles > 1 ? "s" : ""} pour l'apéro dans un rayon de 2 km. Santé !`
          : "😶 Rien ne correspond aux filtres cochés. Essaie d'en cocher d'autres."
      );
    }
  }

  // ---------- Requête Overpass ----------
  function construireRequete(lat, lon) {
    const clauses = Object.values(TYPES)
      .map(
        ({ selecteur }) =>
          `node${selecteur}(around:${RAYON_METRES},${lat},${lon});` +
          `way${selecteur}(around:${RAYON_METRES},${lat},${lon});`
      )
      .join("\n");
    return `[out:json][timeout:25];(\n${clauses}\n);out center;`;
  }

  async function rechercherAutour(lat, lon, libellePosition) {
    afficherStatut('<span class="spinner"></span> On cherche les meilleures adresses…');

    coucheRepere.clearLayers();
    L.circle([lat, lon], {
      radius: RAYON_METRES,
      color: "#3eb489",
      fillColor: "#3eb489",
      fillOpacity: 0.06,
      weight: 2,
    }).addTo(coucheRepere);
    L.circleMarker([lat, lon], {
      radius: 7,
      color: "#ffffff",
      fillColor: "#2e9270",
      fillOpacity: 1,
      weight: 3,
    })
      .bindPopup(`📍 ${echapper(libellePosition)}`)
      .addTo(coucheRepere);

    try {
      const reponse = await fetch(OVERPASS_URL, {
        method: "POST",
        body: "data=" + encodeURIComponent(construireRequete(lat, lon)),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (!reponse.ok) throw new Error(`Overpass a répondu ${reponse.status}`);
      const donnees = await reponse.json();

      const vus = new Set();
      resultats = [];
      for (const el of donnees.elements || []) {
        const cle = `${el.type}/${el.id}`;
        if (vus.has(cle)) continue;
        vus.add(cle);

        const tags = el.tags || {};
        const type = Object.keys(TYPES).find((t) => tags.amenity === t);
        if (!type) continue;

        const position = el.type === "node" ? el : el.center;
        if (!position) continue;

        resultats.push({
          lat: position.lat,
          lon: position.lon,
          nom: tags.name || "Nom inconnu",
          adresse: adresseDe(tags),
          type,
          libelle: TYPES[type].libelle,
          emoji: TYPES[type].emoji,
          terrasse: tags.outdoor_seating === "yes",
        });
      }

      if (resultats.length === 0) {
        afficherStatut(
          "😶 Aucun bar, pub ou café trouvé dans un rayon de 2 km. Vise un centre-ville, c'est plus sûr pour l'apéro."
        );
      } else {
        afficherMarqueurs();
      }
    } catch (erreur) {
      console.error(erreur);
      afficherStatut(
        "⚠️ Impossible d'interroger la base de lieux (service peut-être surchargé). Réessaie dans quelques instants.",
        "erreur"
      );
    }
  }

  // ---------- Géolocalisation ----------
  btnLocaliser.addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      afficherStatut(
        "😕 Ton navigateur ne permet pas la géolocalisation. Tape ta ville dans la recherche.",
        "erreur"
      );
      return;
    }

    btnLocaliser.disabled = true;
    afficherStatut('<span class="spinner"></span> Localisation en cours…');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        btnLocaliser.disabled = false;
        const { latitude, longitude } = position.coords;
        carte.setView([latitude, longitude], 15);
        rechercherAutour(latitude, longitude, "Tu es ici !");
      },
      (erreur) => {
        btnLocaliser.disabled = false;
        const message =
          erreur.code === erreur.PERMISSION_DENIED
            ? "🙅 Géolocalisation refusée — pas grave ! Tape le nom de ta ville dans la recherche ci-dessus."
            : "😕 Impossible de te localiser. Essaie plutôt la recherche par ville.";
        afficherStatut(message, "erreur");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  });

  // ---------- Recherche Nominatim ----------
  formRecherche.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    const texte = champRecherche.value.trim();
    if (!texte) return;

    afficherStatut('<span class="spinner"></span> Recherche de « ' + echapper(texte) + " »…");

    try {
      const params = new URLSearchParams({
        q: texte,
        format: "json",
        limit: "1",
        "accept-language": "fr",
      });
      const reponse = await fetch(`${NOMINATIM_URL}?${params}`);
      if (!reponse.ok) throw new Error(`Nominatim a répondu ${reponse.status}`);
      const lieux = await reponse.json();

      if (lieux.length === 0) {
        afficherStatut(
          `😶 Aucun endroit trouvé pour « ${echapper(texte)} ». Essaie avec un nom de ville.`,
          "erreur"
        );
        return;
      }

      const lieu = lieux[0];
      const lat = parseFloat(lieu.lat);
      const lon = parseFloat(lieu.lon);
      carte.setView([lat, lon], 15);
      rechercherAutour(lat, lon, lieu.display_name.split(",")[0]);
    } catch (erreur) {
      console.error(erreur);
      afficherStatut(
        "⚠️ La recherche d'adresse n'a pas abouti. Réessaie dans quelques instants.",
        "erreur"
      );
    }
  });
})();
