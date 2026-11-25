# ffwf-tau-web

The web client for [τ](https://pypi.org/project/ffwf-tau/), built, as the Python package
`tau_web`. With it installed beside τ, `tau serve` serves the client at `/` with no flags:

```bash
pip install ffwf-tau      # depends on ffwf-tau-web
tau serve                 # open the printed http://127.0.0.1:…/#token=… address
```

It holds files only (`tau_web/dist/`) and runs no Node. Its version follows τ's: ffwf-tau-web
0.17.x speaks protocol 2 and pairs with ffwf-tau 0.17.x.

Check that it matches the τ installed beside it:

```bash
python -m tau_web         # exit 0 if the client and τ speak the same protocol
```

Built from [tau-code](https://github.com/jmccardle/tau-code) `packages/web`; see
`packages/web-py` there.
