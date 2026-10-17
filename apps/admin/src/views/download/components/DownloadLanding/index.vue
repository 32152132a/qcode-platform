<template>
  <div class="landing">
    <header class="navigation wrap">
      <router-link class="brand" to="/" aria-label="QCode 首页">
        <img src="/branding/qcode-96.png" alt="" /><span>QCode</span>
      </router-link>
      <nav aria-label="主导航">
        <a
          class="download-link"
          href="#install"
          @click.prevent="scrollToInstall"
          >下载客户端</a
        >
        <router-link class="console-link" to="/login"
          >管理控制台 <ArrowRight
        /></router-link>
      </nav>
    </header>

    <main>
      <section class="hero wrap" aria-labelledby="hero-title">
        <div class="hero-copy">
          <span class="eyebrow"><span></span> 为团队打造的 AI 工作空间</span>
          <h1 id="hero-title">从一个想法，<br />到<span>完成一件事。</span></h1>
          <p class="intro">
            把 AI 带到你的电脑上。整理资料、起草文档、编写代码，<br
              class="desktop-break"
            />用熟悉的方式，和团队的 AI 一起工作。
          </p>
          <a class="primary-button" href="/downloads/installer"
            ><Download /> 下载 Windows 版 <ArrowRight
          /></a>
          <p class="requirements">Windows 10 / 11 · 64 位 · 内置运行环境</p>
          <div class="hero-notes">
            <span><Check /> 团队账号登录</span
            ><span><Check /> 多模型自由选择</span>
          </div>
        </div>

        <div
          class="preview"
          role="img"
          aria-label="工作台布局示意：左侧会话列表，右侧任务和输入区域。实际界面以客户端为准。"
        >
          <div class="window-bar">
            <span class="window-dots"><i></i><i></i><i></i></span
            ><span>QCode 工作空间</span
            ><span class="preview-label">界面示意</span>
          </div>
          <div class="workspace">
            <aside class="workspace-sidebar">
              <div class="mini-brand">
                <img src="/branding/qcode-96.png" alt="" />QCode
              </div>
              <div class="new-task"><Plus /> 新建任务</div>
              <span class="sidebar-label">最近的任务</span>
              <div class="history active"><Document /> 整理本周项目进展</div>
              <div class="history"><Document /> 起草一份产品说明</div>
              <div class="history"><Folder /> 我的工作文件</div>
              <div class="workspace-user"><span>团队</span> 我的工作空间</div>
            </aside>
            <div class="workspace-content">
              <div class="workspace-heading">
                <span>你的日常，从容一点。</span
                ><span class="model-tag">团队模型 <Check /></span>
              </div>
              <div class="welcome">
                <div class="welcome-symbol">✦</div>
                <h2>今天想完成什么？</h2>
                <p>从一个问题，或一份文件开始。</p>
              </div>
              <div class="suggestions">
                <span><Document /> 整理一份资料</span
                ><span><Cpu /> 解决代码问题</span>
              </div>
              <div class="composer">
                <span>帮我整理本周的项目进展…</span>
                <div>
                  <span><Plus /> 选择工作目录</span
                  ><span class="send"><Top /></span>
                </div>
              </div>
              <span class="preview-footnote"
                >任务在本机执行 · 模型由团队统一配置</span
              >
            </div>
          </div>
        </div>
      </section>

      <div class="wrap"><PlatformIntro /></div>

      <section class="benefits wrap" aria-label="产品特点">
        <article v-for="feature in features" :key="feature.title">
          <span class="feature-icon"><component :is="feature.icon" /></span>
          <div>
            <h2>{{ feature.title }}</h2>
            <p>{{ feature.description }}</p>
          </div>
        </article>
      </section>

      <section
        id="install"
        ref="installSection"
        class="install wrap"
        aria-labelledby="install-title"
      >
        <div class="section-heading">
          <div>
            <span class="eyebrow">开始使用</span>
            <h2 id="install-title">你的下一个工作伙伴。</h2>
          </div>
          <p>安装客户端，登录团队账号，即可开始。</p>
        </div>
        <div class="platforms">
          <article class="platform windows">
            <div class="platform-heading">
              <span class="platform-icon"><Monitor /></span
              ><span class="availability">现已可用</span>
            </div>
            <h3>Windows</h3>
            <p>桌面工作台与终端入口，一次安装。</p>
            <a class="primary-button" href="/downloads/installer"
              ><Download /> 下载 Windows 安装包</a
            ><small>Windows 10 / 11 · x64</small>
          </article>
          <article class="platform mac">
            <div class="platform-heading">
              <span class="platform-icon"><Platform /></span
              ><span class="availability pending">准备中</span>
            </div>
            <h3>macOS</h3>
            <p>为 Mac 准备的桌面工作空间。</p>
            <button class="unavailable-button" disabled>即将推出</button
            ><small>尚未发布，敬请期待。</small>
          </article>
        </div>
        <ol class="steps">
          <li v-for="(step, index) in steps" :key="step.title">
            <span class="step-number">0{{ index + 1 }}</span>
            <div>
              <h3>{{ step.title }}</h3>
              <p>{{ step.description }}</p>
            </div>
          </li>
        </ol>
      </section>
    </main>
    <footer class="footer wrap">
      <span>QCode <span class="footer-divider">/</span> 团队 AI 工作空间</span
      ><router-link to="/login">管理员入口 <ArrowRight /></router-link>
    </footer>
  </div>
</template>

<script setup lang="ts">
import PlatformIntro from "../PlatformIntro/index.vue";
import { ref } from "vue";
import {
  ArrowRight,
  Check,
  Cpu,
  Connection,
  Document,
  Download,
  Folder,
  Lock,
  Monitor,
  Platform,
  Plus,
  Top,
} from "@element-plus/icons-vue";

const installSection = ref<HTMLElement>();
const features = [
  {
    icon: Folder,
    title: "在自己的电脑上工作",
    description: "围绕本地文件和项目开展任务，延续你的工作习惯。",
  },
  {
    icon: Connection,
    title: "一个入口，多种模型",
    description: "团队配置可用模型，客户端直接选择，无需逐一接入。",
  },
  {
    icon: Lock,
    title: "账号与密钥统一管理",
    description: "使用团队账号登录，无需自行配置上游模型密钥。",
  },
];
const steps = [
  {
    title: "安装应用",
    description: "下载并运行安装包，无需额外安装开发环境。",
  },
  { title: "登录团队账号", description: "使用管理员为你创建的账号登录。" },
  {
    title: "选择目录，开始工作",
    description: "选择可用模型和工作目录，发起第一个任务。",
  },
];
function scrollToInstall() {
  installSection.value?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
  });
}
</script>

<style scoped lang="scss">
.landing {
  --ink: #20262f;
  --muted: #6c7482;
  --accent: #525edb;
  background: #fff;
  color: var(--ink);
  min-height: 100vh;
  .wrap {
    width: min(1240px, calc(100% - 112px));
    margin-inline: auto;
  }
  svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }
  a,
  button {
    &:focus-visible {
      outline: 3px solid #818cf8;
      outline-offset: 5px;
    }
  }
  .navigation {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 100px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 11px;
    font-size: 23px;
    font-weight: 650;
    letter-spacing: -0.7px;
    img {
      width: 36px;
      height: 36px;
    }
  }
  nav {
    display: flex;
    gap: 32px;
    align-items: center;
    font-size: 13px;
  }
  .download-link {
    color: var(--muted);
    &:hover {
      color: var(--accent);
    }
  }
  .console-link {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 15px;
    border: 1px solid #e5e7ed;
    border-radius: 8px;
    &:hover {
      background: #f7f8fb;
    }
    svg {
      width: 14px;
    }
  }
  .hero {
    display: grid;
    grid-template-columns: 0.9fr 1.15fr;
    align-items: center;
    gap: 48px;
    padding-block: 86px 104px;
  }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font-size: 12px;
    color: #68719a;
    letter-spacing: 1px;
    > span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #8189d9;
    }
  }
  h1 {
    font-size: clamp(38px, 4.1vw, 58px);
    line-height: 1.25;
    font-weight: 650;
    letter-spacing: -2px;
    margin: 25px 0 23px;
    span {
      color: var(--accent);
    }
  }
  .intro {
    font-size: 14px;
    color: var(--muted);
    line-height: 1.95;
    margin-bottom: 29px;
  }
  .primary-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 48px;
    padding: 0 22px;
    background: var(--accent);
    border-radius: 9px;
    color: white;
    font-size: 14px;
    font-weight: 500;
    transition: background 0.15s;
    &:hover {
      background: #414dc5;
    }
  }
  .requirements {
    color: var(--muted);
    font-size: 11px;
    margin: 13px 0 25px;
  }
  .hero-notes {
    display: flex;
    gap: 22px;
    font-size: 11px;
    color: var(--muted);
    span {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    svg {
      width: 13px;
      color: #727aa6;
    }
  }
  .preview {
    min-width: 0;
    border: 1px solid #e2e5ed;
    border-radius: 14px;
    overflow: hidden;
    background: #fff;
    box-shadow:
      0 24px 65px -25px #28365e38,
      0 4px 14px #2b365c06;
  }
  .window-bar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    background: #fafbfc;
    border-bottom: 1px solid #eceef3;
    min-height: 38px;
    padding: 0 14px;
    font-size: 10px;
    color: #7b8492;
  }
  .window-dots {
    display: flex;
    gap: 5px;
    i {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #dfe3eb;
    }
  }
  .preview-label {
    justify-self: end;
    font-size: 9px;
  }
  .workspace {
    display: grid;
    grid-template-columns: 145px minmax(0, 1fr);
    min-height: 350px;
  }
  .workspace-sidebar {
    display: flex;
    flex-direction: column;
    padding: 18px 10px 13px;
    background: #f8f9fc;
    border-right: 1px solid #eceef3;
  }
  .mini-brand {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 4px 20px;
    font-size: 12px;
    font-weight: 650;
    img {
      width: 21px;
      height: 21px;
    }
  }
  .new-task {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    font-size: 10px;
    padding: 8px;
    border: 1px solid #e2e5ed;
    border-radius: 6px;
    background: #fff;
    svg {
      width: 12px;
      height: 12px;
    }
  }
  .sidebar-label {
    font-size: 9px;
    color: #8a92a1;
    padding: 22px 6px 10px;
  }
  .history {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 9px;
    color: #6d7686;
    padding: 9px 6px;
    border-radius: 5px;
    svg {
      width: 12px;
      height: 12px;
    }
    &.active {
      background: #ebeefa;
      color: #5963a4;
    }
  }
  .workspace-user {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: auto;
    padding: 16px 4px 0;
    font-size: 9px;
    color: #6d7686;
    > span {
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      background: #e6eaf5;
      border-radius: 6px;
      font-size: 8px;
    }
  }
  .workspace-content {
    min-width: 0;
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
  }
  .workspace-heading {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
    color: #7c8595;
    font-size: 9px;
  }
  .model-tag {
    display: flex;
    align-items: center;
    gap: 4px;
    svg {
      width: 10px;
      height: 10px;
      color: #7486ad;
    }
  }
  .welcome {
    margin-top: 40px;
    text-align: center;
    h2 {
      font-size: 19px;
      font-weight: 550;
      margin: 12px 0 8px;
      letter-spacing: -0.5px;
    }
    p {
      font-size: 10px;
      color: #858c9b;
    }
  }
  .welcome-symbol {
    color: #7e86d8;
    font-size: 29px;
    line-height: 1;
  }
  .suggestions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 17px 0;
    > span {
      display: flex;
      align-items: center;
      gap: 6px;
      border: 1px solid #e9ebf1;
      padding: 10px 7px;
      border-radius: 7px;
      font-size: 9px;
      color: #727b8b;
    }
    svg {
      width: 12px;
      height: 12px;
    }
  }
  .composer {
    border: 1px solid #dfe3ed;
    border-radius: 10px;
    padding: 12px;
    font-size: 10px;
    color: #939aaa;
    box-shadow: 0 3px 7px #26315304;
    > div {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 23px;
      > span {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 8px;
      }
    }
    svg {
      width: 12px;
      height: 12px;
    }
    .send {
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      background: #6570da;
      color: #fff;
      border-radius: 6px;
    }
  }
  .preview-footnote {
    margin-top: 10px;
    font-size: 8px;
    color: #9299a7;
    text-align: center;
  }
  .benefits {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 38px;
    padding-block: 30px 46px;
    border-bottom: 1px solid #eceef3;
    article {
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }
    h2 {
      font-size: 14px;
      font-weight: 600;
      margin: 3px 0 9px;
    }
    p {
      font-size: 12px;
      color: var(--muted);
      line-height: 1.9;
      margin: 0;
    }
  }
  .feature-icon {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: #f3f4fa;
    color: #737ca3;
  }
  .install {
    padding-block: 77px 60px;
    scroll-margin-top: 24px;
  }
  .section-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 30px;
    h2 {
      font-size: 29px;
      font-weight: 600;
      margin: 14px 0 0;
      letter-spacing: -1px;
    }
    > p {
      font-size: 12px;
      color: var(--muted);
      margin: 0 0 4px;
    }
  }
  .platforms {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }
  .platform {
    border: 1px solid #e5e8f0;
    border-radius: 14px;
    padding: 28px 32px;
    h3 {
      font-size: 24px;
      margin: 24px 0 10px;
      font-weight: 600;
      letter-spacing: -0.6px;
    }
    > p {
      font-size: 13px;
      color: var(--muted);
      margin: 0 0 25px;
    }
    small {
      display: block;
      font-size: 11px;
      color: var(--muted);
      margin-top: 13px;
    }
    .primary-button {
      font-size: 13px;
      min-height: 43px;
    }
  }
  .windows {
    background: linear-gradient(135deg, #f8f9ff, #fff 65%);
  }
  .platform-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .platform-icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    background: #edf0fb;
    color: #6470b9;
    border-radius: 10px;
    svg {
      width: 22px;
      height: 22px;
    }
  }
  .availability {
    font-size: 10px;
    color: #5c72a0;
    background: #edf1fc;
    border-radius: 20px;
    padding: 5px 9px;
    &.pending {
      color: #7b8491;
      background: #f2f3f6;
    }
  }
  .mac .platform-icon {
    color: #737c89;
    background: #f1f3f6;
  }
  .unavailable-button {
    min-height: 43px;
    padding: 0 26px;
    border: 1px solid #e7e9ef;
    border-radius: 9px;
    color: #818998;
    background: #f5f6f9;
    cursor: not-allowed;
    font-size: 13px;
  }
  .steps {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 34px;
    list-style: none;
    margin: 38px 0 0;
    padding: 0;
    li {
      display: flex;
      align-items: flex-start;
      gap: 13px;
    }
    h3 {
      font-size: 12px;
      font-weight: 600;
      margin: 0 0 7px;
    }
    p {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.8;
      margin: 0;
    }
  }
  .step-number {
    color: #969eb9;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .footer {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    padding-block: 26px 32px;
    border-top: 1px solid #eceef3;
    font-size: 11px;
    color: var(--muted);
    a {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    svg {
      width: 12px;
      height: 12px;
    }
  }
  .footer-divider {
    color: #c6cad5;
    padding-inline: 10px;
  }
  @media (max-width: 1100px) {
    .wrap {
      width: calc(100% - 64px);
    }
    .hero {
      gap: 28px;
    }
    .workspace {
      grid-template-columns: 110px minmax(0, 1fr);
    }
    .workspace-content {
      padding-inline: 14px;
    }
    .workspace-heading > span:first-child {
      display: none;
    }
    .workspace-heading {
      justify-content: flex-end;
    }
    .desktop-break {
      display: none;
    }
  }
  @media (max-width: 820px) {
    .hero {
      grid-template-columns: 1fr;
      padding-block: 52px 50px;
      gap: 45px;
    }
    .hero-copy {
      text-align: center;
    }
    h1 {
      font-size: 49px;
    }
    .hero-notes {
      justify-content: center;
    }
    .preview {
      width: min(600px, 100%);
      justify-self: center;
    }
    .workspace {
      grid-template-columns: 145px minmax(0, 1fr);
    }
    .benefits {
      gap: 24px;
      article {
        flex-direction: column;
        gap: 10px;
      }
    }
    .section-heading {
      align-items: flex-start;
      flex-direction: column;
      gap: 14px;
    }
    .install {
      padding-top: 52px;
    }
  }
  @media (max-width: 540px) {
    .wrap {
      width: calc(100% - 40px);
    }
    .navigation {
      min-height: 78px;
    }
    .brand {
      font-size: 20px;
      img {
        width: 30px;
        height: 30px;
      }
    }
    nav {
      gap: 0;
    }
    .download-link {
      display: none;
    }
    .console-link {
      font-size: 11px;
      padding: 9px 10px;
    }
    h1 {
      font-size: 40px;
      letter-spacing: -1.5px;
    }
    .intro {
      font-size: 13px;
    }
    .hero {
      padding-top: 40px;
    }
    .workspace {
      grid-template-columns: minmax(0, 1fr);
      min-height: 320px;
    }
    .workspace-sidebar {
      display: none;
    }
    .workspace-content {
      padding: 16px 20px;
    }
    .welcome {
      margin-top: 25px;
    }
    .suggestions {
      margin-block: 16px;
    }
    .preview-footnote {
      font-size: 8px;
    }
    .benefits,
    .platforms,
    .steps {
      grid-template-columns: 1fr;
    }
    .benefits {
      gap: 24px;
      article {
        flex-direction: row;
        gap: 14px;
      }
    }
    .section-heading h2 {
      font-size: 25px;
    }
    .platform {
      padding: 25px;
    }
    .steps {
      gap: 23px;
    }
    .footer {
      flex-direction: column;
      gap: 15px;
    }
  }
}
</style>
