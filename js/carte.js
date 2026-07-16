/* ============================================================
   carte.js — logique de la page « Carte »
   - Carte Leaflet + tuiles OpenStreetMap
   - Géolocalisation navigateur
   - Recherche de ville/lieu via Nominatim (gratuit, sans clé)
   - Recherche des points d'intérêt via l'API Overpass

   Bonnes pratiques d'usage des API publiques :
   - les requêtes ne partent QUE sur action de l'utilisateur
     (clic « Me localiser » ou validation de la recherche) ;
   - une seule requête Overpass par position : les cases à
     cocher filtrent ensuite les résultats côté navigateur.
   ============================================================ */

(() => {
  "use strict";

  // ---------- Configuration ----------
  const RAYON_METRES = 2000; // rayon de recherche autour du point
  const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
  const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

  /*
   * Chaque filtre « en langage simple » regroupe un ou plusieurs
   * sélecteurs de tags OpenStreetMap. L'utilisateur ne voit jamais
   * ces tags : uniquement les libellés des cases à cocher.
   */
  const DEFINITIONS_FILTRES = {
    // --- Groupe « Lieux climatisés / au frais » ---
    cinema:       { groupe: "frais",   selecteurs: ['["amenity"="cinema"]'] },
    bibliotheque: { groupe: "frais",   selecteurs: ['["amenity"="library"]'] },
    musee:        { groupe: "frais",   selecteurs: ['["tourism"="museum"]'] },
    commerce:     { groupe: "frais",   selecteurs: ['["shop"="mall"]', '["shop"="supermarket"]'] },
    climatise:    { groupe: "frais",   selecteurs: ['["air_conditioning"="yes"]'] },
    // --- Groupe « Magasins & installateurs de clim » ---
    specialiste:  { groupe: "magasin", selecteurs: ['["shop"="hvac"]', '["craft"="hvac"]'] },
    bricolage:    { groupe: "magasin", selecteurs: ['["shop"="doityourself"]', '["shop"="hardware"]', '["shop"="trade"]'] },
  };

  // Traduction des tags OSM en libellés clairs pour les popups
  const TYPES_EN_CLAIR = [
    { tag: "amenity", valeur: "cinema",       libelle: "Cinéma",                emoji: "🎬", filtre: "cinema" },
    { tag: "amenity", valeur: "library",      libelle: "Bibliothèque",          emoji: "📚", filtre: "bibliotheque" },
    { tag: "tourism", valeur: "museum",       libelle: "Musée",                 emoji: "🖼️", filtre: "musee" },
    { tag: "shop",    valeur: "mall",         libelle: "Centre commercial",     emoji: "🛍️", filtre: "commerce" },
    { tag: "shop",    valeur: "supermarket",  libelle: "Supermarché",           emoji: "🛒", filtre: "commerce" },
    { tag: "shop",    valeur: "hvac",         libelle: "Magasin de climatisation", emoji: "❄️", filtre: "specialiste" },
    { tag: "craft",   valeur: "hvac",         libelle: "Installateur de climatisation", emoji: "🔧", filtre: "specialiste" },
    { tag: "shop",    valeur: "doityourself", libelle: "Magasin de bricolage",  emoji: "🔨", filtre: "bricolage" },
    { tag: "shop",    valeur: "hardware",     libelle: "Quincaillerie",         emoji: "🔩", filtre: "bricolage" },
    { tag: "shop",    valeur: "trade",        libelle: "Négoce professionnel",  emoji: "🏗️", filtre: "bricolage" },
  ];

  /*
   * Types fréquents qui remontent uniquement grâce au tag
   * air_conditioning=yes (testé sur données réelles : restaurants,
   * hôtels…). Permet un libellé plus précis que « Lieu climatisé ».
   */
  const TYPES_CLIMATISES = {
    restaurant: { libelle: "Restaurant", emoji: "🍽️" },
    fast_food:  { libelle: "Restauration rapide", emoji: "🍔" },
    cafe:       { libelle: "Café", emoji: "☕" },
    bar:        { libelle: "Bar", emoji: "🍸" },
    pub:        { libelle: "Pub", emoji: "🍺" },
    pharmacy:   { libelle: "Pharmacie", emoji: "💊" },
    hotel:      { libelle: "Hôtel", emoji: "🏨" },
  };

  // ---------- Éléments du DOM ----------
  const btnLocaliser = document.getElementById("btn-localiser");
  const formRecherche = document.getElementById("form-recherche");
  const champRecherche = document.getElementById("champ-recherche");
  const zoneStatut = document.getElementById("statut");
  const casesFrais = [...document.querySelectorAll(".filtre-frais")];
  const casesMagasin = [...document.querySelectorAll(".filtre-magasin")];
  const caseGroupeFrais = document.getElementById("groupe-frais");
  const caseGroupeMagasins = document.getElementById("groupe-magasins");

  // ---------- Initialisation de la carte ----------
  const carte = L.map("carte").setView([46.6, 2.4], 6); // vue France par défaut

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(carte);

  const coucheMarqueurs = L.layerGroup().addTo(carte); // marqueurs des résultats
  const coucheRepere = L.layerGroup().addTo(carte);    // position + cercle de recherche

  // Résultats de la dernière requête Overpass, filtrés côté client
  let resultats = [];

  // ---------- Messages d'état ----------
  function afficherStatut(html, type = "info") {
    zoneStatut.className = `statut visible ${type}`;
    zoneStatut.innerHTML = html;
  }

  function masquerStatut() {
    zoneStatut.className = "statut";
    zoneStatut.innerHTML = "";
  }

  // ---------- Cases à cocher : case « Tout le groupe » ----------
  function brancherGroupe(caseGroupe, sousCases) {
    caseGroupe.addEventListener("change", () => {
      sousCases.forEach((c) => (c.checked = caseGroupe.checked));
      afficherMarqueurs();
    });
    sousCases.forEach((c) =>
      c.addEventListener("change", () => {
        caseGroupe.checked = sousCases.some((s) => s.checked);
        afficherMarqueurs();
      })
    );
  }

  brancherGroupe(caseGroupeFrais, casesFrais);
  brancherGroupe(caseGroupeMagasins, casesMagasin);

  function filtresCoches() {
    return [...casesFrais, ...casesMagasin]
      .filter((c) => c.checked)
      .map((c) => c.value);
  }

  // ---------- Identification d'un résultat ----------
  /*
   * Retourne { libelle, emoji, filtre, groupe } pour un jeu de tags OSM.
   * Les magasins sont testés en premier : un magasin climatisé reste
   * classé « magasin ». Un lieu sans type connu mais climatisé est
   * classé « lieu climatisé ».
   */
  function identifier(tags) {
    const magasin = TYPES_EN_CLAIR.find(
      (t) => DEFINITIONS_FILTRES[t.filtre].groupe === "magasin" && tags[t.tag] === t.valeur
    );
    if (magasin) return { ...magasin, groupe: "magasin" };

    const frais = TYPES_EN_CLAIR.find(
      (t) => DEFINITIONS_FILTRES[t.filtre].groupe === "frais" && tags[t.tag] === t.valeur
    );
    if (frais) return { ...frais, groupe: "frais" };

    if (tags.air_conditioning === "yes") {
      const connu = TYPES_CLIMATISES[tags.amenity] || TYPES_CLIMATISES[tags.tourism];
      return {
        libelle: connu ? connu.libelle : "Lieu climatisé",
        emoji: connu ? connu.emoji : "❄️",
        filtre: "climatise",
        groupe: "frais",
      };
    }
    return null;
  }

  // ---------- Affichage des marqueurs (filtrage côté client) ----------
  function afficherMarqueurs() {
    coucheMarqueurs.clearLayers();
    const actifs = filtresCoches();

    let visibles = 0;
    for (const lieu of resultats) {
      // Un lieu climatisé « générique » n'apparaît que si sa case est cochée,
      // mais un cinéma climatisé apparaît dès que « Cinémas » est coché.
      const correspond =
        actifs.includes(lieu.filtre) ||
        (lieu.tags.air_conditioning === "yes" && actifs.includes("climatise"));
      if (!correspond) continue;

      const icone = L.divIcon({
        className: "", // on laisse notre CSS gérer tout le style
        html: `<div class="marqueur ${lieu.groupe}">${lieu.emoji}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 28],
        popupAnchor: [0, -26],
      });

      const badgeClim =
        lieu.tags.air_conditioning === "yes"
          ? '<br><span class="popup-badge">❄️ Climatisé</span>'
          : "";

      const adresseHtml = lieu.adresse
        ? `<div class="popup-adresse">📮 ${echapper(lieu.adresse)}</div>`
        : "";

      L.marker([lieu.lat, lieu.lon], { icon: icone })
        .bindPopup(
          `<div class="popup-nom">${echapper(lieu.nom)}</div>` +
          `<div class="popup-type">${lieu.emoji} ${lieu.libelle}${badgeClim}</div>` +
          adresseHtml +
          `<a class="popup-lien" href="${lienGoogleMaps(lieu)}" target="_blank" rel="noopener">Voir sur Google Maps ↗</a>`
        )
        .addTo(coucheMarqueurs);
      visibles++;
    }

    if (resultats.length > 0) {
      afficherStatut(
        visibles > 0
          ? `✅ <strong>${visibles}</strong> lieu${visibles > 1 ? "x" : ""} affiché${visibles > 1 ? "s" : ""} dans un rayon de 2 km.`
          : "😶 Aucun lieu ne correspond aux filtres cochés. Essaie d'en cocher d'autres."
      );
    }
  }

  // Petite protection contre l'injection HTML dans les popups
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

  // ---------- Requête Overpass ----------
  /*
   * Construit une requête Overpass QL : pour chaque sélecteur de tags,
   * une clause node/way/relation avec `around:` centré sur (lat, lon).
   * `out center` renvoie un point central pour les ways et relations,
   * ce qui permet de placer un marqueur unique par objet.
   */
  function construireRequete(lat, lon) {
    const selecteurs = Object.values(DEFINITIONS_FILTRES).flatMap((d) => d.selecteurs);
    const clauses = selecteurs
      .map(
        (sel) =>
          `node${sel}(around:${RAYON_METRES},${lat},${lon});` +
          `way${sel}(around:${RAYON_METRES},${lat},${lon});` +
          `relation${sel}(around:${RAYON_METRES},${lat},${lon});`
      )
      .join("\n");
    return `[out:json][timeout:25];(\n${clauses}\n);out center;`;
  }

  async function rechercherAutour(lat, lon, libellePosition) {
    afficherStatut('<span class="spinner"></span> Recherche des lieux frais en cours…');

    // Repère visuel : position + rayon de recherche
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

      // Dédoublonnage (un objet peut correspondre à plusieurs sélecteurs)
      const vus = new Set();
      resultats = [];
      for (const el of donnees.elements || []) {
        const cle = `${el.type}/${el.id}`;
        if (vus.has(cle)) continue;
        vus.add(cle);

        const tags = el.tags || {};
        const identite = identifier(tags);
        if (!identite) continue;

        // Un nœud a lat/lon ; un way ou une relation a un « center »
        const position = el.type === "node" ? el : el.center;
        if (!position) continue;

        resultats.push({
          lat: position.lat,
          lon: position.lon,
          nom: tags.name || "Nom inconnu",
          adresse: adresseDe(tags),
          tags,
          ...identite,
        });
      }

      if (resultats.length === 0) {
        afficherStatut(
          "😶 Aucun lieu trouvé dans un rayon de 2 km. Essaie une autre adresse ou un centre-ville proche."
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
        "😕 Ton navigateur ne permet pas la géolocalisation. Utilise la recherche par ville ci-dessous.",
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
            ? "🙅 Géolocalisation refusée — pas de souci ! Tape le nom de ta ville dans la recherche ci-dessus."
            : "😕 Impossible de te localiser. Essaie plutôt la recherche par ville.";
        afficherStatut(message, "erreur");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  });

  // ---------- Recherche Nominatim (ville ou lieu) ----------
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
      // Le navigateur envoie automatiquement le Referer de la page,
      // ce qui identifie le site conformément à la politique Nominatim.
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
