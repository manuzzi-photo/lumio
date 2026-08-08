# social/

`github-social.png` (1280×640) ist die Karte, die GitHub, Slack, Mastodon und
Co. zeigen, wenn jemand den Repo-Link teilt.

**GitHub liest sie nicht aus dem Repo.** Sie muss einmalig hochgeladen werden:

> Repo → **Settings** → Abschnitt *Social preview* → **Edit** → `github-social.png`

Danach bleibt sie liegen und muss erst wieder angefasst werden, wenn sich die
Marke ändert. Ein Test geht über <https://www.opengraph.xyz/> oder indem man
den Link in einen Slack-Kanal wirft.

Der Text ist bewusst **englisch** — der README ist englisch geführt und GitHub
ist das internationale Schaufenster. Die deutschen Fassungen liegen bei den
Marketing-Sites unter deren `brand/og-default.svg`.

Neu erzeugen: `python3 ../src/github.py`
