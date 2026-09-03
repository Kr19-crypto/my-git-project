# Contributing to My Git Project

欢迎参与本项目。为了协作顺畅，请先阅读并遵守以下约定。

## 协作流程

1. 在 GitHub 上查看 Issue / 任务清单，或先开 Issue 讨论要做的内容。
2. Fork 仓库（或由维护者直接添加为 Collaborator）。
3. 从最新的 `main` 分支创建功能分支：
   ```bash
   git fetch origin
   git checkout -b feat/your-feature origin/main
   ```
4. 在功能分支上提交，并保持提交信息清晰。
5. 推送分支并创建 Pull Request：
   ```bash
   git push -u origin feat/your-feature
   ```
6. PR 描述中说明改动内容、测试方式以及关联 Issue。

## 分支约定

- `main`：稳定可发布分支，禁止直接推送，必须通过 PR 合入。
- `feat/*`：新功能。
- `fix/*`：缺陷修复。
- `docs/*`：文档更新。
- `chore/*`：构建、依赖、配置等杂项。

## Commit 规范

推荐使用 Conventional Commits 风格：

```text
feat: add new feature
fix: correct bug
docs: update README
refactor: improve structure
test: add tests
chore: update tooling
```

示例：

```bash
git commit -m "feat: add login endpoint"
```

## 代码风格

- 技术栈确定后，优先使用官方或社区通用风格工具（如 ESLint、Prettier、Black、gofmt 等）。
- 保持提交内容聚焦：一个提交只做一件事。
- 不提交密钥、本地配置、生成物和依赖缓存（见 `.gitignore`）。

## 测试

- 新增功能应尽量包含测试。
- 推送前请确保相关测试通过。
- 如果项目当前没有测试框架，请在引入时一并补充说明。

## 文档

- 涉及接口、配置、环境变量、部署方式的变更，需要同步更新 README 或 `docs/`。
- 重大变更建议在 CHANGELOG 或 Release Notes 中记录。
