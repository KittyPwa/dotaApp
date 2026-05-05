import { createContext, useContext, useEffect } from "react";
import type { ReactNode } from "react";
import type { AppLanguage } from "../api/client";

const fr = {
  "Dashboard": "Tableau de bord",
  "Lookup": "Recherche",
  "Compare": "Comparer",
  "Drafts": "Drafts",
  "Heroes": "Heros",
  "Leagues": "Ligues",
  "Settings": "Parametres",
  "Players": "Joueurs",
  "Matches": "Matchs",
  "Teams": "Equipes",
  "Overview": "Apercu",
  "Vision": "Vision",
  "Timelines": "Chronologies",
  "Rosters": "Roster",
  "Builds": "Builds",
  "Recent matches": "Matchs recents",
  "Recent local matches": "Matchs locaux recents",
  "Loading...": "Chargement...",
  "Loading settings...": "Chargement des parametres...",
  "Loading dashboard...": "Chargement du tableau de bord...",
  "Loading player...": "Chargement du joueur...",
  "Loading match...": "Chargement du match...",
  "Loading heroes...": "Chargement des heros...",
  "Loading leagues...": "Chargement des ligues...",
  "Unknown": "Inconnu",
  "Unavailable": "Indisponible",
  "No data": "Aucune donnee",
  "None": "Aucun",
  "All": "Tout",
  "All leagues": "Toutes les ligues",
  "All ranks": "Tous les rangs",
  "Any rank to Immortal": "Tout rang jusqu'a Immortal",
  "Source": "Source",
  "Cache": "Cache",
  "Local appearances": "Apparitions locales",
  "Last synced": "Derniere synchro",
  "Visible matches": "Matchs visibles",
  "Local matches": "Matchs locaux",
  "Match scope": "Portee des matchs",
  "Win / loss": "Victoires / defaites",
  "History synced": "Historique synchronise",
  "Current + previous 12 patches": "Patch actuel + 12 precedents",
  "Winrate": "Taux de victoire",
  "Unique players": "Joueurs uniques",
  "League scope": "Portee ligue",
  "Rank scope": "Portee rang",
  "Avg first core": "Premier core moyen",
  "High success": "Succes eleve",
  "Low success": "Succes faible",
  "With this hero": "Avec ce heros",
  "Against this hero": "Contre ce heros",
  "Above baseline": "Au-dessus du seuil",
  "Below baseline": "Sous le seuil",
  "Opponents above baseline": "Adversaires au-dessus du seuil",
  "Opponents below baseline": "Adversaires sous le seuil",
  "ally-roster matches and": "matchs avec rosters allies et",
  "opponent-roster matches contribute here.": "matchs avec rosters adverses contribuent ici.",
  "allied final-inventory matches and": "matchs avec inventaires finaux allies et",
  "opponent final-inventory matches contribute here.": "matchs avec inventaires finaux adverses contribuent ici.",
  "scoped matches checked.": "matchs de la portee verifies.",
  "scoped matches checked. Final inventory only, 1500+ gold.":
    "matchs de la portee verifies. Inventaire final uniquement, 1500+ gold.",
  "No available above-baseline hero pairings with this hero yet.":
    "Aucun duo de heros disponible au-dessus du seuil avec ce heros.",
  "No available below-baseline hero pairings with this hero yet.":
    "Aucun duo de heros disponible sous le seuil avec ce heros.",
  "No available opponent heroes above baseline in available roster data yet.":
    "Aucun heros adverse disponible au-dessus du seuil dans les rosters disponibles.",
  "No available opponent heroes below baseline in available roster data yet.":
    "Aucun heros adverse disponible sous le seuil dans les rosters disponibles.",
  "No available above-baseline item patterns with this hero yet.":
    "Aucun schema d'objet disponible au-dessus du seuil avec ce heros.",
  "No available below-baseline item patterns with this hero yet.":
    "Aucun schema d'objet disponible sous le seuil avec ce heros.",
  "No available above-baseline item patterns against this hero yet.":
    "Aucun schema d'objet disponible au-dessus du seuil contre ce heros.",
  "No available below-baseline item patterns against this hero yet.":
    "Aucun schema d'objet disponible sous le seuil contre ce heros.",
  "Heroes with this hero": "Heros avec ce heros",
  "Heroes against this hero": "Heros contre ce heros",
  "Items with this hero": "Objets avec ce heros",
  "Items against this hero": "Objets contre ce heros",
  "Language": "Langue",
  "French": "Francais",
  "English": "Anglais",
  "Colorblind mode": "Mode daltonien",
  "Dark mode": "Mode sombre",
  "Admin password": "Mot de passe admin",
  "Admin access": "Acces admin",
  "Data scope": "Portee des donnees",
  "Accessibility": "Accessibilite",
  "Providers": "Fournisseurs",
  "Diagnostics": "Diagnostics",
  "Community": "Communaute",
  "Save for this browser": "Enregistrer pour ce navigateur",
  "Apply for this session": "Appliquer pour cette session",
  "Save settings": "Enregistrer les parametres",
  "Settings saved locally.": "Parametres enregistres localement.",
  "Saving...": "Enregistrement...",
  "New password": "Nouveau mot de passe",
  "Confirm password": "Confirmer le mot de passe",
  "Set admin password": "Definir le mot de passe admin",
  "Password": "Mot de passe",
  "Unlock admin controls": "Debloquer les controles admin",
  "Lock admin controls": "Verrouiller les controles admin",
  "OpenDota API key": "Cle API OpenDota",
  "STRATZ API key": "Cle API STRATZ",
  "Steam API key": "Cle API Steam",
  "Primary player ID": "ID du joueur principal",
  "Tracked leagues": "Ligues suivies",
  "Add league": "Ajouter une ligue",
  "Remove": "Retirer",
  "Provider request usage": "Utilisation des requetes fournisseur",
  "Recently enriched matches": "Matchs recemment enrichis",
  "Recent provider attempts": "Tentatives fournisseur recentes",
  "Match": "Match",
  "Provider": "Fournisseur",
  "Status": "Statut",
  "Parsed": "Analyse",
  "Attempts": "Tentatives",
  "Attempted": "Tente le",
  "Next": "Suivant",
  "Reason": "Raison",
  "Matches to scan": "Matchs a scanner",
  "Jobs to process": "Taches a traiter",
  "Enqueue missing telemetry": "Mettre la telemetrie manquante en file",
  "Process queue now": "Traiter la file maintenant",
  "No provider queue entries yet.": "Aucune entree dans la file fournisseur pour le moment.",
  "No fully enriched matches yet.": "Aucun match completement enrichi pour le moment.",
  "No provider attempts have run yet.": "Aucune tentative fournisseur n'a encore ete lancee.",
  "Draft library": "Bibliotheque de drafts",
  "Scope": "Portee",
  "League": "Ligue",
  "Hero search": "Recherche heros",
  "Access code": "Code d'acces",
  "Use code": "Utiliser le code",
  "New draft": "Nouveau draft",
  "Delete": "Supprimer",
  "Back to drafts": "Retour aux drafts",
  "Draft access code": "Code d'acces aux drafts",
  "I saved it": "Je l'ai sauvegarde",
  "First pick side": "Cote first pick",
  "Second pick side": "Cote second pick",
  "First pick": "First pick",
  "Second pick": "Second pick",
  "No team assigned": "Aucune equipe assignee",
  "No opponent assigned": "Aucun adversaire assigne",
  "Hero name": "Nom du heros",
  "Pick": "Pick",
  "Ban": "Ban",
  "Team pool": "Pool equipe",
  "Player comforts": "Conforts joueurs",
  "Player": "Joueur",
  "Hero": "Heros",
  "Result": "Resultat",
  "Duration": "Duree",
  "Started": "Debut",
  "Kills": "Kills",
  "Deaths": "Morts",
  "Assists": "Assists",
  "KDA": "KDA",
  "GPM": "GPM",
  "XPM": "XPM",
  "Hero damage": "Degats heros",
  "Tower damage": "Degats tours",
  "Healing": "Soins",
  "Last hits": "Last hits",
  "Denies": "Denies",
  "Items": "Objets",
  "Radiant": "Radiant",
  "Dire": "Dire",
  "Win": "Victoire",
  "Loss": "Defaite",
  "Won": "Gagne",
  "Lost": "Perdu",
  "Rank": "Rang",
  "Queue": "File d'attente",
  "All heroes": "Tous les heros",
  "All queues": "Toutes les files",
  "Ranked": "Classe",
  "Unranked": "Non classe",
  "Turbo": "Turbo",
  "Set as your player": "Definir comme votre joueur",
  "Unset as your player": "Retirer comme votre joueur",
  "Add to favorites": "Ajouter aux favoris",
  "Remove favorite": "Retirer des favoris",
  "Refresh on open": "Actualiser a l'ouverture",
  "Stop refresh on open": "Arreter l'actualisation a l'ouverture",
  "Compare this player": "Comparer ce joueur",
  "Deeper player history synced locally.": "Historique joueur approfondi synchronise localement.",
  "Scope and actions": "Portee et actions",
  "Teammates": "Co-equipiers",
  "Most played with": "Le plus joue avec",
  "Performance radar": "Radar de performance",
  "Match activity calendar": "Calendrier d'activite des matchs",
  "No locally stored matches yet.": "Aucun match local stocke pour le moment.",
  "No observer ward coordinates are available for this player's active scope yet.":
    "Aucune coordonnee de ward observer n'est disponible pour la portee active de ce joueur.",
  "Player observer ward heatmap": "Carte de chaleur des wards observers du joueur",
  "No locally stored hero usage for the active match scope yet.":
    "Aucune utilisation de heros stockee localement pour la portee active des matchs.",
  "No repeated teammates found in the local dataset yet.": "Aucun co-equipier repete trouve dans les donnees locales.",
  "Not enough local stat data to draw a radar chart yet.": "Pas assez de donnees locales pour dessiner un radar.",
  "All players are hidden. Use the legend below to show them again.":
    "Tous les joueurs sont masques. Utilisez la legende ci-dessous pour les afficher a nouveau.",
  "Single-player view uses fixed benchmark ranges so the shape remains readable.":
    "La vue a un seul joueur utilise des reperes fixes pour garder la forme lisible.",
  "Each axis is scaled against the best selected visible player for that stat, so the chart compares relative strengths within this group.":
    "Chaque axe est calibre sur le meilleur joueur visible selectionne pour cette statistique, afin de comparer les forces relatives dans ce groupe.",
  "Radar chart": "Radar",
  "Courier kills": "Coursiers tues",
  "Impact": "Impact",
  "MVP rate %": "Taux MVP %",
  "Lane winrate %": "Taux de lane gagnee %",
  "Camp stacked": "Camps stacks",
  "Observer wards destroyed": "Wards observers detruites",
  "Ward efficiency %": "Efficacite des wards %",
  "Wards placed": "Wards posees",
  "Hero healing": "Soins heros",
  "Degats heros": "Degats heros",
  "Degats tours": "Degats tours",
  "Patch": "Patch",
  "League filter": "Filtre ligue",
  "Rank filter": "Filtre rang",
  "Apply filters": "Appliquer les filtres",
  "Reset": "Reinitialiser",
  "Refresh": "Actualiser",
  "Sync": "Synchroniser",
  "Search": "Rechercher",
  "Name": "Nom",
  "Games": "Parties",
  "Wins": "Victoires",
  "Losses": "Defaites",
  "Total": "Total",
  "Average": "Moyenne",
  "Activity": "Activite",
  "Vision heat map": "Carte de chaleur vision",
  "Wards": "Wards",
  "Observer wards": "Wards observers",
  "Sentry wards": "Wards sentries",
  "Draft": "Draft",
  "Draft row": "Ligne de draft",
  "Unassigned": "Non assigne",
  "No saved drafts for this league yet.": "Aucun draft sauvegarde pour cette ligue pour le moment.",
  "No saved drafts for this access code yet. Select a league to create the first one.":
    "Aucun draft sauvegarde pour ce code d'acces pour le moment. Selectionnez une ligue pour creer le premier.",
  "Keep this code somewhere safe. It is the only way to load these drafts from another browser or device.":
    "Gardez ce code dans un endroit sur. C'est le seul moyen de charger ces drafts depuis un autre navigateur ou appareil.",
  "This choice stays in this browser and does not change server settings.":
    "Ce choix reste dans ce navigateur et ne modifie pas les parametres serveur.",
  "Active ward state is not available from the provider for this match.":
    "L'etat actif des wards n'est pas disponible via le fournisseur pour ce match.",
  "Add tournaments you want to analyze locally": "Ajoutez les tournois que vous voulez analyser localement",
  "Admin controls are unlocked for this browser session.": "Les controles admin sont debloques pour cette session navigateur.",
  "All locally stored matches are included when the patch filter is disabled.":
    "Tous les matchs stockes localement sont inclus quand le filtre de patch est desactive.",
  "Any rank": "Tout rang",
  "Assign a team with local data to see comfort picks.": "Assignez une equipe avec des donnees locales pour voir les picks confort.",
  "Assign a team with local match data to see players.": "Assignez une equipe avec des matchs locaux pour voir les joueurs.",
  "At least 10 characters": "Au moins 10 caracteres",
  "Average GPM": "GPM moyen",
  "Average XPM": "XPM moyen",
  "Avg rank": "Rang moyen",
  "Backpack": "Sac",
  "Best local winrates": "Meilleurs taux de victoire locaux",
  "Click a hero combination above to inspect the exact matches behind that stat.":
    "Cliquez sur une combinaison de heros ci-dessus pour inspecter les matchs exacts derriere cette statistique.",
  "Comma-separated player IDs": "IDs de joueurs separes par des virgules",
  "Common items": "Objets frequents",
  "Community relationship graph": "Graphe des relations communaute",
  "Compare players": "Comparer les joueurs",
  "Comparison setup": "Configuration de comparaison",
  "Computing hero analytics...": "Calcul des analyses heros...",
  "Connections": "Connexions",
  "Current player": "Joueur actuel",
  "Damage": "Degats",
  "Damage taken": "Degats subis",
  "Damage taken timeline": "Chronologie des degats subis",
  "Data availability": "Disponibilite des donnees",
  "Date": "Date",
  "Day": "Jour",
  "Dire roster": "Dire roster",
  "Dota map ward placements": "Placements de wards sur la carte Dota",
  "Draft name": "Nom du draft",
  "Draft overview": "Apercu du draft",
  "Draft workspace": "Espace de draft",
  "Due now": "Du maintenant",
  "Enriched": "Enrichi",
  "Enter at least two player IDs to compare them.": "Entrez au moins deux IDs de joueurs pour les comparer.",
  "Example: 148440404": "Exemple : 148440404",
  "Farm": "Farm",
  "Favorite players": "Joueurs favoris",
  "Fetch a player or match first to populate hero analytics.":
    "Recuperez d'abord un joueur ou un match pour alimenter les analyses heros.",
  "First core timing": "Timing du premier core",
  "First match": "Premier match",
  "First side players": "Joueurs du premier cote",
  "Force a fresh OpenDota fetch and STRATZ telemetry enrichment for this match":
    "Forcer une recuperation OpenDota fraiche et un enrichissement STRATZ pour ce match",
  "Full parsed": "Analyse complete",
  "Full STRATZ matches": "Matchs STRATZ complets",
  "Gold": "Or",
  "Gold timeline": "Chronologie de l'or",
  "Hero build sections": "Sections de build heros",
  "Hero combinations together": "Combinaisons de heros ensemble",
  "Hero damage timeline": "Chronologie des degats heros",
  "Hero or item": "Heros ou objet",
  "Hero performance": "Performance des heros",
  "Hero sections": "Sections heros",
  "Hero stats": "Stats heros",
  "Hero usage": "Utilisation des heros",
  "Hour": "Heure",
  "Inventory": "Inventaire",
  "Item": "Objet",
  "Item build": "Build d'objets",
  "Item timings": "Timings d'objets",
  "Items all purchases": "Objets tous achats",
  "Items core and completed": "Objets core et termines",
  "Items over 1500 gold": "Objets de plus de 1500 or",
  "Items: all purchases": "Objets : tous achats",
  "Items: core/completed": "Objets : core/termines",
  "Kill participation": "Participation aux kills",
  "Last match": "Dernier match",
  "Last processed": "Dernier traitement",
  "Last worker run": "Derniere execution du worker",
  "Last-hit timeline": "Chronologie des last hits",
  "Latest match": "Match le plus recent",
  "League matches": "Matchs de ligue",
  "League pick rate": "Taux de pick en ligue",
  "League sections": "Sections de ligue",
  "Level": "Niveau",
  "Limit match views and analytics to recent patches by default":
    "Limiter par defaut les vues de matchs et analyses aux patchs recents",
  "Loading community links...": "Chargement des liens communaute...",
  "Loading draft context...": "Chargement du contexte de draft...",
  "Loading hero detail...": "Chargement du detail heros...",
  "Loading league...": "Chargement de la ligue...",
  "Loading local leagues...": "Chargement des ligues locales...",
  "Loading match detail...": "Chargement du detail match...",
  "Loading match detail…": "Chargement du detail match...",
  "Loading player comparison...": "Chargement de la comparaison joueurs...",
  "Loading player data...": "Chargement des donnees joueur...",
  "Loading provider queue...": "Chargement de la file fournisseur...",
  "Loading team...": "Chargement de l'equipe...",
  "Loading…": "Chargement...",
  "Local leagues": "Ligues locales",
  "Match data refreshed.": "Donnees du match actualisees.",
  "Match lookup": "Recherche de match",
  "Match result filter": "Filtre de resultat de match",
  "Match sections": "Sections du match",
  "Match, hero, league, queue": "Match, heros, ligue, file",
  "Match, opponent, patch": "Match, adversaire, patch",
  "Match, patch, league": "Match, patch, ligue",
  "Minute": "Minute",
  "Most played heroes": "Heros les plus joues",
  "Most played heroes in your local data": "Heros les plus joues dans vos donnees locales",
  "Name or Steam ID": "Nom ou Steam ID",
  "Net worth": "Net worth",
  "Next attempt": "Prochaine tentative",
  "Next worker run": "Prochaine execution du worker",
  "No draft plans are saved for this team in this browser profile yet.":
    "Aucun plan de draft n'est sauvegarde pour cette equipe dans ce profil navigateur.",
  "No favorite relationships stored yet.": "Aucune relation favorite stockee pour le moment.",
  "No hero data stored for this league.": "Aucune donnee heros stockee pour cette ligue.",
  "No hero data stored for this team yet.": "Aucune donnee heros stockee pour cette equipe pour le moment.",
  "No hero-combination data found in shared matches yet.":
    "Aucune donnee de combinaison de heros trouvee dans les matchs partages pour le moment.",
  "No item build data stored for this hero yet.": "Aucune donnee de build d'objets stockee pour ce heros.",
  "No item timing data available for this view.": "Aucune donnee de timing d'objets disponible pour cette vue.",
  "No league-tagged matches are stored yet. Fetch full league/tournament matches to populate this view.":
    "Aucun match tague ligue n'est stocke. Recuperez des matchs complets de ligue/tournoi pour alimenter cette vue.",
  "No local combo data for this side yet.": "Aucune donnee locale de combo pour ce cote.",
  "No local hero data for this filter yet.": "Aucune donnee heros locale pour ce filtre.",
  "No local hero data yet": "Aucune donnee heros locale pour le moment",
  "No locally stored matches found for this league.": "Aucun match stocke localement trouve pour cette ligue.",
  "No matches stored for this filter yet.": "Aucun match stocke pour ce filtre.",
  "No matches stored for this team yet.": "Aucun match stocke pour cette equipe.",
  "No matching local matches were found for this combination.":
    "Aucun match local correspondant n'a ete trouve pour cette combinaison.",
  "No pairwise overlap found in the local dataset yet.": "Aucun chevauchement par paire trouve dans les donnees locales.",
  "No picks or bans were stored for this match.": "Aucun pick ou ban n'a ete stocke pour ce match.",
  "No player data stored for this hero in this league.": "Aucune donnee joueur stockee pour ce heros dans cette ligue.",
  "No player data stored for this league.": "Aucune donnee joueur stockee pour cette ligue.",
  "No player data stored for this team yet.": "Aucune donnee joueur stockee pour cette equipe.",
  "No player usage is stored for this hero yet.": "Aucune utilisation joueur n'est stockee pour ce heros.",
  "No players match the current search.": "Aucun joueur ne correspond a la recherche actuelle.",
  "No qualifying item data stored for this league.": "Aucune donnee d'objet qualifiante stockee pour cette ligue.",
  "No shared matches in local data yet.": "Aucun match partage dans les donnees locales.",
  "No skill order data has been normalized for this hero yet.":
    "Aucune donnee d'ordre de sorts n'a ete normalisee pour ce heros.",
  "No stored matches found for this hero.": "Aucun match stocke trouve pour ce heros.",
  "No team data stored for this league yet.": "Aucune donnee equipe stockee pour cette ligue.",
  "No team hero data yet.": "Aucune donnee heros d'equipe pour le moment.",
  "No timeline data available for overlay.": "Aucune donnee de chronologie disponible pour la superposition.",
  "No timeline data available for this tab.": "Aucune donnee de chronologie disponible pour cet onglet.",
  "No timeline data available for this view.": "Aucune donnee de chronologie disponible pour cette vue.",
  "No tracked leagues yet.": "Aucune ligue suivie pour le moment.",
  "No ward placement coordinates are available for this match.": "Aucune coordonnee de placement de ward disponible pour ce match.",
  "Not enough player stat data to draw a team radar yet.": "Pas assez de donnees joueur pour dessiner le radar d'equipe.",
  "Observers": "Observers",
  "Only locally stored matches that include normalized skill-order telemetry are counted here.":
    "Seuls les matchs stockes localement avec telemetrie d'ordre de sorts normalisee sont comptes ici.",
  "Only matches with stored purchase-log telemetry contribute to this item tree.":
    "Seuls les matchs avec journal d'achats stocke contribuent a cet arbre d'objets.",
  "Open match": "Ouvrir le match",
  "Open player": "Ouvrir le joueur",
  "Opponent": "Adversaire",
  "Optional": "Optionnel",
  "Outcome": "Resultat",
  "Pairwise synergy": "Synergie par paire",
  "Parsed data": "Donnees analysees",
  "Passwords do not match.": "Les mots de passe ne correspondent pas.",
  "Player lookup": "Recherche de joueur",
  "Player sections": "Sections joueur",
  "Player timelines": "Chronologies joueur",
  "Player usage": "Utilisation joueur",
  "Priority players": "Joueurs prioritaires",
  "Provider enrichment queue": "File d'enrichissement fournisseur",
  "Provider notes": "Notes fournisseur",
  "Purchase log": "Journal d'achats",
  "Quick pick from your player + favorites": "Selection rapide depuis votre joueur + favoris",
  "Radiant roster": "Radiant roster",
  "Rank range": "Plage de rang",
  "Recent shared matches": "Matchs partages recents",
  "Record": "Bilan",
  "Relationship graph": "Graphe des relations",
  "Repeat the password": "Repetez le mot de passe",
  "Required for STRATZ enrichment": "Requis pour l'enrichissement STRATZ",
  "Roster radar": "Roster radar",
  "Roster timeline": "Roster timeline",
  "Run enrichment worker automatically": "Lancer automatiquement le worker d'enrichissement",
  "Score": "Score",
  "Search hero": "Rechercher un heros",
  "Second": "Seconde",
  "Second side players": "Joueurs du second cote",
  "Select a player in the graph.": "Selectionnez un joueur dans le graphe.",
  "Select a player to inspect their links.": "Selectionnez un joueur pour inspecter ses liens.",
  "Select hero": "Selectionner un heros",
  "Selected player": "Joueur selectionne",
  "Selected players": "Joueurs selectionnes",
  "Sentries": "Sentries",
  "Shared matches": "Matchs partages",
  "Show provider coverage and enrichment status": "Afficher la couverture fournisseur et l'etat d'enrichissement",
  "Showing all locally stored shared matches for this exact player-to-hero combination.":
    "Affiche tous les matchs partages stockes localement pour cette combinaison exacte joueur-heros.",
  "Skill build": "Build de sorts",
  "Start": "Debut",
  "Stat radar": "Radar de stats",
  "Stored leagues": "Ligues stockees",
  "Stored match history": "Historique de matchs stocke",
  "Stored matches": "Matchs stockes",
  "Stored matches for this hero": "Matchs stockes pour ce heros",
  "Team": "Equipe",
  "Team comparison": "Comparaison des equipes",
  "Team drafts": "Drafts d'equipe",
  "Team matches": "Matchs d'equipe",
  "Team sections": "Sections d'equipe",
  "Team timelines": "Chronologies equipe",
  "This player has no visible links in the current filter.": "Ce joueur n'a aucun lien visible avec le filtre actuel.",
  "Top heroes": "Top heros",
  "Total kills": "Kills totaux",
  "Used for public player/match/hero data. Optional for local MVP usage.":
    "Utilise pour les donnees publiques joueur/match/heros. Optionnel pour l'usage MVP local.",
  "Used for Valve Dota match history and league sync":
    "Utilise pour l'historique de matchs Valve Dota et la synchronisation des ligues",
  "Used for Valve league match listing and Steam-backed Dota endpoints.":
    "Utilise pour la liste des matchs de ligue Valve et les endpoints Dota via Steam.",
  "Vision and utility": "Vision et utilitaire",
  "Vision logs": "Logs de vision",
  "Vision map": "Carte de vision",
  "Ward efficiency": "Efficacite des wards",
  "Win %": "Victoire %",
  "Winner": "Vainqueur",
  "Worker": "Worker",
  "XP timeline": "Chronologie XP",
  "Your player": "Votre joueur"
} satisfies Record<string, string>;

const translations: Record<AppLanguage, Record<string, string>> = {
  fr: {
    "app.name": "Dota Analytics",
    "nav.dashboard": "Tableau de bord",
    "nav.lookup": "Recherche",
    "nav.compare": "Comparer",
    "nav.drafts": "Drafts",
    "nav.heroes": "Heros",
    "nav.leagues": "Ligues",
    "nav.settings": "Parametres",
    "settings.title": "Parametres",
    "settings.loading": "Chargement des parametres...",
    "settings.adminPassword": "Mot de passe admin",
    "settings.adminAccess": "Acces admin",
    "settings.settings": "Parametres",
    "settings.tabs.players": "Joueurs",
    "settings.tabs.leagues": "Ligues",
    "settings.tabs.data": "Portee des donnees",
    "settings.tabs.accessibility": "Accessibilite",
    "settings.tabs.providers": "Fournisseurs",
    "settings.tabs.diagnostics": "Diagnostics",
    "settings.tabs.community": "Communaute",
    "settings.accessibility.language": "Langue",
    "settings.accessibility.languageHelp": "Ce choix reste dans ce navigateur et ne modifie pas les parametres serveur.",
    "settings.accessibility.french": "Francais",
    "settings.accessibility.english": "English",
    "settings.accessibility.colorblind": "Mode daltonien",
    "settings.accessibility.dark": "Mode sombre",
    "settings.accessibility.colorHelp":
      "Ajuste les couleurs de victoire, defaite, equipe et chronologie pour limiter la dependance rouge-vert.",
    "settings.accessibility.darkHelp": "Bascule l'interface vers une palette plus sombre pour ce navigateur.",
    "settings.save.saving": "Enregistrement...",
    "settings.save.browser": "Enregistrer pour ce navigateur",
    "settings.save.session": "Appliquer pour cette session",
    "settings.save.settings": "Enregistrer les parametres",
    "settings.save.success": "Parametres enregistres localement.",
    ...fr
  },
  en: {
    "app.name": "Dota Analytics",
    "nav.dashboard": "Dashboard",
    "nav.lookup": "Lookup",
    "nav.compare": "Compare",
    "nav.drafts": "Drafts",
    "nav.heroes": "Heroes",
    "nav.leagues": "Leagues",
    "nav.settings": "Settings",
    "settings.title": "Settings",
    "settings.loading": "Loading settings...",
    "settings.adminPassword": "Admin password",
    "settings.adminAccess": "Admin access",
    "settings.settings": "Settings",
    "settings.tabs.players": "Players",
    "settings.tabs.leagues": "Leagues",
    "settings.tabs.data": "Data scope",
    "settings.tabs.accessibility": "Accessibility",
    "settings.tabs.providers": "Providers",
    "settings.tabs.diagnostics": "Diagnostics",
    "settings.tabs.community": "Community",
    "settings.accessibility.language": "Language",
    "settings.accessibility.languageHelp": "This choice stays in this browser and does not change server settings.",
    "settings.accessibility.french": "Francais",
    "settings.accessibility.english": "English",
    "settings.accessibility.colorblind": "Colorblind mode",
    "settings.accessibility.dark": "Dark mode",
    "settings.accessibility.colorHelp":
      "Adjusts win/loss, team, and timeline colors to a palette that is easier to distinguish without red-green dependence.",
    "settings.accessibility.darkHelp": "Switches the interface to a darker palette for this browser.",
    "settings.save.saving": "Saving...",
    "settings.save.browser": "Save for this browser",
    "settings.save.session": "Apply for this session",
    "settings.save.settings": "Save settings",
    "settings.save.success": "Settings saved locally."
  }
};

const I18nContext = createContext({ language: "fr" as AppLanguage });

export function I18nProvider({ language, children }: { language: AppLanguage; children: ReactNode }) {
  useDocumentTranslation(language);
  return <I18nContext.Provider value={{ language }}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const { language } = useContext(I18nContext);
  const t = (key: string) => translations[language][key] ?? translations.fr[key] ?? key;
  return { language, t };
}

const textNodeOriginals = new WeakMap<Text, string>();
const attributeNames = ["placeholder", "title", "aria-label"] as const;

function translateLiteral(language: AppLanguage, value: string) {
  if (language === "en") return value;
  const trimmed = value.trim();
  const translated = translations.fr[trimmed];
  if (!translated) return value;
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  return `${leading}${translated}${trailing}`;
}

function translateElement(element: Element, language: AppLanguage) {
  if (element.closest("[data-no-translate]")) return;
  for (const attr of attributeNames) {
    const current = element.getAttribute(attr);
    if (current === null) continue;
    const originalAttr = `data-i18n-original-${attr}`;
    const original = element.getAttribute(originalAttr) ?? current;
    if (!element.hasAttribute(originalAttr)) element.setAttribute(originalAttr, original);
    element.setAttribute(attr, translateLiteral(language, original));
  }
}

function translateTree(root: Node, language: AppLanguage) {
  if (typeof document === "undefined") return;
  if (root.nodeType === Node.TEXT_NODE) {
    const text = root as Text;
    const parent = text.parentElement;
    if (parent && !parent.closest("[data-no-translate]") && text.textContent?.trim()) {
      const original = textNodeOriginals.get(text) ?? text.textContent;
      if (!textNodeOriginals.has(text)) textNodeOriginals.set(text, original);
      text.textContent = translateLiteral(language, original);
    }
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      const parent = text.parentElement;
      if (parent && !parent.closest("[data-no-translate]") && text.textContent?.trim()) {
        const original = textNodeOriginals.get(text) ?? text.textContent;
        if (!textNodeOriginals.has(text)) textNodeOriginals.set(text, original);
        text.textContent = translateLiteral(language, original);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      translateElement(node as Element, language);
    }
    node = walker.nextNode();
  }
}

function useDocumentTranslation(language: AppLanguage) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    let pendingNodes = new Set<Node>([document.body]);
    let scheduled = 0;
    const flush = () => {
      scheduled = 0;
      const nodes = [...pendingNodes];
      pendingNodes = new Set();
      for (const node of nodes) {
        if (node.isConnected) translateTree(node, language);
      }
    };
    const schedule = (node: Node) => {
      pendingNodes.add(node);
      if (scheduled) return;
      scheduled = window.requestAnimationFrame(flush);
    };
    schedule(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
              schedule(node);
            }
          });
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    return () => {
      observer.disconnect();
      if (scheduled) window.cancelAnimationFrame(scheduled);
    };
  }, [language]);
}
