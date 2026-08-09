**English** · [Deutsch](README.de.md)

# social/

`github-social.png` (1280×640) is the card GitHub, Slack, Mastodon and others
show when someone shares the repository link.

**GitHub does not read it from the repository.** It has to be uploaded once:

> Repo → **Settings** → *Social preview* section → **Edit** → `github-social.png`

After that it stays put and only needs touching when the brand changes. To test,
run the link through <https://www.opengraph.xyz/> or just drop it into a Slack
channel.

The text is deliberately **English** — the README is English-first and GitHub is
the international shop window. The German versions live with the marketing sites
under their `brand/og-default.svg`.

Regenerate with `python3 ../src/github.py`.
