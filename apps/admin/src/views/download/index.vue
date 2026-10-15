<template>
  <div class="download">
    <header>
      <a class="brand" href="#/download"><img src="/branding/qcode-96.png" alt="" />QCode</a
      ><router-link to="/login">管理控制台 →</router-link>
    </header>
    <main>
      <span class="eyebrow">YOUR TEAM. YOUR MODELS.</span>
      <h1>让 AI 成为你的<br />日常工作伙伴。</h1>
      <p>一个账号，连接团队的模型与知识。<br />在自己的电脑上完成写作、编程和文件任务。</p>
      <div class="downloads">
        <el-card shadow="never"
          ><h2>Windows 桌面版</h2>
          <p>桌面工作台与终端，一次安装。</p>
          <a class="download-button" href="/downloads/installer">下载 Windows 安装包</a
          ><small>Windows 10 / 11 · x64 · 内置运行环境</small></el-card
        ><el-card shadow="never"
          ><h2>macOS 桌面版</h2>
          <p>为 Mac 准备的工作空间。</p>
          <el-button disabled size="large">即将推出</el-button
          ><small>当前暂未发布，请等待后续版本。</small></el-card
        >
      </div>
      <div class="steps">
        <div>
          <b>01</b>
          <h3>安装应用</h3>
          <p>下载并运行安装包，无需配置开发环境。</p>
        </div>
        <div>
          <b>02</b>
          <h3>登录账号</h3>
          <p>使用管理员创建的团队账号。</p>
        </div>
        <div>
          <b>03</b>
          <h3>开始工作</h3>
          <p>选择模型和项目目录，直接开始。</p>
        </div>
      </div>
    </main>
    <footer>QCode · 团队私有 AI 工作空间</footer>
  </div>
</template>
<style scoped lang="scss">
  .download {
    background: #fbfcfe;
    min-height: 100vh;
    header,
    main,
    footer {
      max-width: 1180px;
      margin: auto;
      padding: 30px 40px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 14px;
      color: #708096;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      color: #253347;
      font-size: 24px;
      font-weight: 650;
      img {
        width: 38px;
        height: 38px;
      }
    }
    main {
      padding-top: 88px;
    }
    .eyebrow {
      font-size: 11px;
      letter-spacing: 3px;
      color: #7285ba;
    }
    h1 {
      font-size: clamp(38px, 5vw, 66px);
      line-height: 1.23;
      letter-spacing: -2px;
      margin: 25px 0;
    }
    p {
      color: #8792a4;
      line-height: 1.9;
    }
    .downloads {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin: 46px 0 62px;
      .el-card {
        border-radius: 18px;
        padding: 20px;
        border-color: #e5eaf3;
      }
      h2 {
        font-size: 20px;
      }
      .download-button {
        display: inline-block;
        border-radius: 10px;
        background: #4d67d9;
        color: white;
        padding: 14px 22px;
        margin: 10px 0;
      }
      small {
        display: block;
        color: #929bad;
        margin-top: 16px;
        font-size: 12px;
      }
    }
    .steps {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 36px;
      b {
        color: #acb8d4;
        font-size: 12px;
      }
      h3 {
        font-size: 17px;
      }
      p {
        font-size: 13px;
      }
    }
    footer {
      color: #a0a9b9;
      font-size: 12px;
      padding-top: 55px;
    }
    @media (max-width: 650px) {
      header,
      main,
      footer {
        padding: 24px;
      }
      main {
        padding-top: 50px;
      }
      .downloads,
      .steps {
        grid-template-columns: 1fr;
      }
      .downloads {
        margin-bottom: 40px;
      }
    }
  }
</style>
