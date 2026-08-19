[English](README.md) · [Deutsch](README.de.md) · **Italiano**

# social/

`github-social.png` (1280×640) è la card che GitHub, Slack, Mastodon e altri
mostrano quando qualcuno condivide il link del repository.

**GitHub non la legge dal repository.** Deve essere caricata una volta:

> Repo → **Settings** → sezione *Social preview* → **Edit** → `github-social.png`

Dopodiché resta ferma e va toccata di nuovo solo quando cambia la marca. Per
testarla, passa il link su <https://www.opengraph.xyz/> o incollalo in un
canale Slack.

Il testo è deliberatamente in **inglese** — il README è inglese-first e GitHub
è la vetrina internazionale. Le versioni tedesche vivono con i siti marketing
sotto il loro `brand/og-default.svg`.

Rigenera con `python3 ../src/github.py`.
