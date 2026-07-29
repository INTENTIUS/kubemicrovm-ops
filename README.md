# kubemicrovm-ops

A chant adoption kit for [KubeMicroVM](https://github.com/codriverlabs/KubeMicroVM). Typed declarations, semantic lint, and durable deployment workflows for teams running AWS Lambda MicroVMs through the KubeMicroVM operator.

This repo currently holds the design. The docs are a Hugo site.

```bash
hugo server
```

## Layout

| Path | Contents |
|------|----------|
| `content/docs/` | Design documents |
| `themes/hugo-book` | Theme (git submodule) |

## Related

| Project | Role |
|---------|------|
| [chant](https://github.com/INTENTIUS/chant) | Core compiler, aws and k8s lexicons, Ops |
| [KubeMicroVM](https://github.com/codriverlabs/KubeMicroVM) | The operator this kit deploys and declares against |
