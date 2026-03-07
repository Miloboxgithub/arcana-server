---
AIGC:
    ContentProducer: Minimax Agent AI
    ContentPropagator: Minimax Agent AI
    Label: AIGC
    ProduceID: 9456ffba55ca4a41d16052d1ecf3f6f3
    PropagateID: 9456ffba55ca4a41d16052d1ecf3f6f3
    ReservedCode1: 304402206eb5d5fc7f215344d11c29784fb56f03be92c078e23c2739947aff2f5834c0f20220394138e79f26f82a5892b4539416119195e6f3f37afb02deb018eef0c6ba723c
    ReservedCode2: 3045022058ba7ed37abb7e1360b297f5c5c63c92027bfed5d3a56113813313fe9c3a2dbb022100d59d65e490ad76bc18dcb3116b581fd73afafbff5db53949b803bdff1c39e28e
---

# ARCANA Backend · 后端

> 本文档聚焦后端技术细节。产品背景请参考：[项目全景文档](../README.md)

---

## 技术栈

- **框架**：Hono + TypeScript
- **数据库**：PostgreSQL（Supabase）
- **认证**：JWT
- **部署**：Railway
- **端口**：3000

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 生产运行
npm run start
```

## 环境变量

复制 `.env.example` 为 `.env` 并配置：

```env
PORT=3000
DATABASE_URL=your_supabase_postgres_url
JWT_SECRET=your_jwt_secret
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /auth/register | 用户注册 |
| POST | /auth/login | 用户登录 |
| GET | /user/profile | 获取用户资料 |
| PUT | /user/profile | 更新用户资料 |

## 开发规范

### 分支规范
```
main     ← 稳定版本
dev      ← 日常开发
feat/*   ← 功能分支
fix/*    ← Bug 修复
```

### Commit 规范
```
feat: 新功能 | fix: 修复 | docs: 文档 | chore: 构建/配置 | style: 样式 | refactor: 重构
```

---

*参考项目全景文档：/workspace/projects/README.md*
