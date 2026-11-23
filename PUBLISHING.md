# 发布操作手册

面向维护者。**所有命令都在仓库根目录执行。**

## 0. 打开发布前先确认没有泄露

```powershell
node scripts/privacy-check.mjs
```

它会拦住：个人邮箱、本机绝对路径、真实 API key、以及 git 历史里的作者邮箱。
任何一条没通过都不要继续。

## 1. 发布到 npm（让别人 `npm i` / `npx dsh` 装）

首次需要登录：

```powershell
npm login          # 浏览器授权，或粘贴有 publish 权限的 token
```

然后：

```powershell
# 先看这次到底会打包哪些文件（files 字段决定）
npm pack --dry-run

# 版本号 +1（patch / minor / major 按改动选）
npm version patch --no-git-tag-version

# 发布
npm publish --access public
```

注意：`package.json` 里的 `private: true` 会把 npm 发布挡掉。
**发布前要把它改成 `false` 或删掉**，否则 `npm publish` 直接报错。

## 2. 发布到 GitHub Releases（让人下载 zip）

```powershell
$tag = "v1.1.0"
git tag $tag
git push origin $tag

# 只打包运行时需要的文件，不含开发脚本
npm pack
gh release create $tag ./*.tgz --title "Folia AI 桥接 $tag" --notes-file CHANGELOG.md
```

## 3. 提交前确认作者身份不是个人邮箱

本仓库已配置只用 GitHub noreply 地址提交：

```powershell
git config user.name  "songdongze"
git config user.email "150308233+songdongze@users.noreply.github.com"
```

**历史里已经存在的个人邮箱提交**：如果那是唯一提交，最干净的做法是重写它
（`git commit --amend --author="..." --no-edit` 后 force push）。已经推送过的
历史改写会影响任何已有的 clone，私下项目可以直接做。

## 4. 隐私清单（每次发版前过一遍）

- [ ] `node scripts/privacy-check.mjs` 全绿
- [ ] `npm pack --dry-run` 的文件列表里没有测试产物、日志、本地配置
- [ ] README 里没有出现自己的用户名、内网地址、真实端口以外的路径
- [ ] 截图/图标里没有露出真实姓名、聊天记录、账号
- [ ] 提交作者是 noreply 地址
