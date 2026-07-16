# 🌿 Au Frais !

Site statique (HTML / CSS / JavaScript pur — aucun framework, aucun build) qui aide à
trouver des **lieux climatisés et points de fraîcheur** près de chez soi, tout en
sensibilisant à un **usage responsable de la climatisation**.

## Pages

| Page | Contenu |
|---|---|
| `index.html` | Accueil et présentation |
| `carte.html` | Carte interactive des lieux frais et des magasins/installateurs de clim |
| `ecologie.html` | Impact écologique de la clim, chiffres vérifiés et sourcés (ADEME, RTE, AIE), conseils |
| `terrasses.html` | « Une mousse au frais » : bars, cafés et pubs avec terrasse autour de soi |

## Technologies

- [Leaflet](https://leafletjs.com/) via CDN pour les cartes (tuiles OpenStreetMap) ;
- [API Overpass](https://overpass-api.de/) pour trouver les lieux (rayon de 2 km) ;
- [Nominatim](https://nominatim.org/) pour la recherche de villes ;
- géolocalisation via l'API du navigateur.

**Aucune clé API, aucun compte, aucune dépendance payante.** Les requêtes vers les
API publiques ne partent que sur action de l'utilisateur (clic ou validation), et les
filtres s'appliquent côté navigateur sans requête supplémentaire.

