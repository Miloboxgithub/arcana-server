# ARCANA Server · 奥义后端

> ARCANA API 服务端

---

## 项目概况

| 项目 | 说明 |
|------|------|
| 服务名 | ARCANA API Server |
| 框架 | Express.js + TypeScript |
| 端口 | 3000 |
| 部署 | Railway |

## 技术栈

- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Database**: PostgreSQL (Supabase)
- **Auth**: JWT

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build
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

## 分支规范

```
main     ← 稳定版本
dev      ← 日常开发
feat/*   ← 功能分支
fix/*    ← Bug 修复
```

## 团队

| 角色 | 负责 |
|------|------|
| Milo | 产品决策 |
| Sylphy | 产品设计 |
| Roxy | 工程架构、代码实现 |
| Eris | 品牌策略 |

---

*ARCANA — 让每一天都成为你命运牌上的一笔。*
