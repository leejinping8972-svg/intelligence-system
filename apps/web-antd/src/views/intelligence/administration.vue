<script setup lang="ts">
import type { AdminUser } from './session';

import { computed, onDeactivated, onMounted, reactive, ref, watch } from 'vue';

import {
  Alert,
  Button,
  Form,
  Input,
  message,
  Modal,
  Select,
  Table,
  Tag,
} from 'ant-design-vue';

import {
  startCloudSync,
  stopCloudSync,
  syncCloudWorkspace,
} from './cloud-workspace';
import PageHeader from './components/PageHeader.vue';
import PlatformLinkSettings from './components/PlatformLinkSettings.vue';
import UnifiedIdentitySettings from './components/UnifiedIdentitySettings.vue';
import { adminRequest, leaveSession, session } from './session';

const isAdmin = computed(() => session.user?.role === 'admin');
const error = ref('');
const busy = ref(false);
const users = ref<AdminUser[]>([]);
const events = ref<
  Array<{ action: string; username: string; targetId: string; at: number }>
>([]);
const createOpen = ref(false);
const newUser = reactive({
  username: '',
  displayName: '',
  password: '',
  role: 'researcher',
});
const roleOptions = [
  { label: '管理员', value: 'admin' },
  { label: '研究员', value: 'researcher' },
];
const passwordForm = reactive({
  username: session.user?.username || '',
  currentPassword: '',
  password: '',
  confirmPassword: '',
});
const resetUser = ref<AdminUser>();
const resetPassword = ref('');
const database = reactive({
  engine: '',
  host: '',
  database: '',
  maintenance: false,
  connectionMode: '',
});
const db = reactive({
  host: 'rm-bp17h3w0e2dte4l4r8o.mysql.rds.aliyuncs.com',
  database: 'leo',
  user: '',
  password: '',
  ca: '',
  tlsMode: 'ssl',
});
const dbVerified = ref(false);
const dbBusy = ref(false);
const dbMessage = ref('');
const caName = ref('');
const migrateOpen = ref(false);
watch(db, () => {
  dbVerified.value = false;
});
const date = (value: null | number) =>
  value ? new Date(value).toLocaleString('zh-CN') : '尚未登录';
const asUser = (record: Record<string, unknown>) =>
  record as unknown as AdminUser;
async function run(work: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  try {
    await work();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '操作失败';
  } finally {
    busy.value = false;
  }
}
async function load() {
  if (!isAdmin.value) return;
  const result = await adminRequest<{
    users: AdminUser[];
    events: typeof events.value;
  }>('auth_users');
  users.value = result.users;
  events.value = result.events;
  Object.assign(database, await adminRequest('database_status'));
}
onMounted(() => run(load));
onDeactivated(() => {
  db.password = '';
  newUser.password = '';
  resetPassword.value = '';
  passwordForm.currentPassword = '';
  passwordForm.password = '';
  passwordForm.confirmPassword = '';
});
async function createUser() {
  await run(async () => {
    await adminRequest('auth_create_user', { ...newUser });
    newUser.password = '';
    createOpen.value = false;
    Object.assign(newUser, {
      username: '',
      displayName: '',
      role: 'researcher',
    });
    await load();
    message.success('账号已创建');
  });
}
async function changeUser(user: AdminUser, role: unknown, enabled: boolean) {
  await run(async () => {
    await adminRequest('auth_update_user', { id: user.id, role, enabled });
    await load();
    message.success('账号权限已更新，原登录会话已失效');
  });
}
async function changePassword() {
  await run(async () => {
    if (passwordForm.password !== passwordForm.confirmPassword)
      throw new Error('两次输入的新密码不一致');
    await adminRequest('auth_change_password', { ...passwordForm });
    leaveSession();
  });
}
async function saveReset() {
  await run(async () => {
    await adminRequest('auth_reset_password', {
      id: resetUser.value?.id,
      password: resetPassword.value,
    });
    resetPassword.value = '';
    resetUser.value = undefined;
    await load();
    message.success('密码已重设，该账号需要重新登录');
  });
}
async function uploadCA(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 32_000) {
    message.error('CA证书不能超过32KB，请选择解压后的PEM/CRT证书');
    return;
  }
  db.ca = await file.text();
  caName.value = file.name;
}
async function testDatabase() {
  dbBusy.value = true;
  dbMessage.value = '';
  dbVerified.value = false;
  try {
    const result = await adminRequest<{ message: string; version: string }>(
      'database_test',
      { ...db },
    );
    dbVerified.value = true;
    dbMessage.value = `${result.message} · MySQL ${result.version}`;
  } catch (cause) {
    dbMessage.value = cause instanceof Error ? cause.message : '连接验证失败';
  } finally {
    dbBusy.value = false;
  }
}
async function migrateDatabase() {
  dbBusy.value = true;
  migrateOpen.value = false;
  dbMessage.value = '正在暂停同步、备份、复制及校验数据，请勿重复提交。';
  try {
    await syncCloudWorkspace();
    stopCloudSync();
    const result = await adminRequest<{ message: string }>(
      'database_migrate',
      { ...db, confirm: 'migrate-to-leo' },
      300_000,
    );
    db.password = '';
    dbMessage.value = result.message;
    setTimeout(() => location.reload(), 6000);
  } catch (cause) {
    dbMessage.value =
      cause instanceof Error
        ? cause.message
        : '迁移未完成，请刷新查看当前数据库状态后再试';
    startCloudSync();
  } finally {
    dbBusy.value = false;
  }
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="账号与管理"
      :show-market="false"
      description="管理工作区成员、登录安全与独立数据库。"
    />
    <Alert
      v-if="error"
      :message="error"
      type="error"
      show-icon
      role="alert"
      style="margin-bottom: 20px"
    />
    <section class="hci-panel">
      <div class="hci-panel-head">
        <h2>我的账号</h2>
        <Tag>{{ isAdmin ? '管理员' : '研究员' }}</Tag>
      </div>
      <p class="hci-subtle">
        {{ session.user?.displayName }} ·
        {{ session.user?.username }}。修改密码后，所有设备需要重新登录。
      </p>
      <Form
        :model="passwordForm"
        layout="vertical"
        class="admin-password-form"
        @finish="changePassword"
      >
        <Form.Item
          name="username"
          label="登录账号"
          :rules="[{ required: true, message: '请填写登录账号' }]"
          ><Input
            v-model:value="passwordForm.username"
            autocomplete="username"
            :maxlength="64" /></Form.Item
        ><Form.Item
          name="currentPassword"
          label="当前密码"
          :rules="[{ required: true, message: '请填写当前密码' }]"
        >
          <Input.Password
            v-model:value="passwordForm.currentPassword"
            autocomplete="current-password"
          />
        </Form.Item>
        <Form.Item
          name="password"
          label="新密码"
          :rules="[{ min: 8, max: 128, message: '密码需要8～128个字符' }]"
        >
          <Input.Password
            v-model:value="passwordForm.password"
            autocomplete="new-password"
            placeholder="至少8个字符；仅改账号时留空"
            :maxlength="128"
          />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          :rules="[
            { required: !!passwordForm.password, message: '请再次输入新密码' },
          ]"
        >
          <Input.Password
            v-model:value="passwordForm.confirmPassword"
            autocomplete="new-password"
          />
        </Form.Item>
        <Button html-type="submit" :loading="busy">保存账号与密码</Button>
      </Form>
    </section>
    <UnifiedIdentitySettings v-if="session.identityEnabled" />
    <PlatformLinkSettings v-else-if="session.user" />
    <template v-if="isAdmin">
      <section class="hci-panel">
        <div class="hci-panel-head">
          <h2>管理员与成员</h2>
          <Button type="primary" @click="createOpen = true">新增账号</Button>
        </div>
        <p class="hci-subtle">
          管理员可管理账号、数据源与数据库；研究员可执行研究、查看和整理业务数据。系统始终保留至少一位启用的管理员。
        </p>
        <Table
          :data-source="users"
          row-key="id"
          :pagination="false"
          :scroll="{ x: 850 }"
          :columns="[
            { title: '账号', key: 'name' },
            { title: '角色', key: 'role' },
            { title: '状态', key: 'enabled' },
            { title: '最近登录', key: 'lastLoginAt' },
            { title: '操作', key: 'actions' },
          ]"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">
              <strong>{{ record.displayName }}</strong>
              <div class="hci-subtle">{{ record.username }}</div>
            </template>
            <Select
              v-if="column.key === 'role'"
              :value="record.role"
              :options="roleOptions"
              :disabled="busy || record.id === session.user?.id"
              style="width: 120px"
              aria-label="账号角色"
              @change="
                (value) => changeUser(asUser(record), value, record.enabled)
              "
            />
            <Tag
              v-if="column.key === 'enabled'"
              :color="record.enabled ? 'green' : 'default'"
            >
              {{ record.enabled ? '启用' : '停用' }}
            </Tag>
            <template v-if="column.key === 'lastLoginAt'">
              {{ date(record.lastLoginAt) }}
            </template>
            <div v-if="column.key === 'actions'" class="admin-row-actions">
              <Button
                :disabled="record.id === session.user?.id || busy"
                @click="
                  changeUser(asUser(record), record.role, !record.enabled)
                "
              >
                {{ record.enabled ? '停用' : '启用' }} </Button
              ><Button
                :disabled="record.id === session.user?.id || busy"
                @click="resetUser = asUser(record)"
              >
                重设密码
              </Button>
            </div>
          </template>
        </Table>
      </section>
      <section class="hci-panel" id="database">
        <div class="hci-panel-head">
          <h2>独立数据库</h2>
          <Tag :color="database.engine === 'mysql' ? 'green' : 'blue'">
            {{
              database.engine === 'mysql'
                ? '已使用阿里云 MySQL'
                : '当前使用服务器 PostgreSQL'
            }}
          </Tag>
        </div>
        <p class="hci-subtle">
          当前数据库：{{ database.database }} ·
          {{ database.host }}。连接凭证只加密保存在服务器，不写入浏览器缓存。
        </p>
        <template v-if="database.engine !== 'mysql'">
          <Alert
            type="info"
            show-icon
            message="支持数据库现有的普通连接，也可选择SSL加密连接。使用对 leo 有读写、建表权限的账号，迁移前请等待后台任务完成。"
          />
          <Form
            :model="db"
            layout="vertical"
            class="admin-db-form"
            @finish="testDatabase"
          >
            <Form.Item label="连接方式"
              ><Select
                v-model:value="db.tlsMode"
                :disabled="dbBusy"
                :options="[
                  { label: 'SSL 加密连接', value: 'ssl' },
                  {
                    label: '普通连接（数据库未启用SSL时使用）',
                    value: 'plain',
                  },
                ]"
            /></Form.Item>
            <Alert
              v-if="db.tlsMode === 'plain'"
              type="warning"
              show-icon
              message="普通连接不加密服务器与数据库之间的传输；不需要上传CA证书。连接凭证仍加密保存在服务器。"
              style="margin-bottom: 20px"
            />
            <Form.Item label="数据库地址">
              <Input :value="db.host" readonly />
            </Form.Item>
            <div class="hci-form-grid">
              <Form.Item label="数据库名">
                <Input :value="db.database" readonly /> </Form.Item
              ><Form.Item label="端口">
                <Input value="3306" readonly />
              </Form.Item>
              <Form.Item
                name="user"
                label="数据库账号"
                :rules="[
                  {
                    required: true,
                    whitespace: true,
                    message: '请填写数据库账号',
                  },
                ]"
              >
                <Input
                  v-model:value="db.user"
                  autocomplete="off"
                  placeholder="RDS数据库账号"
                  :disabled="dbBusy"
                />
              </Form.Item>
              <Form.Item
                name="password"
                label="数据库密码"
                :rules="[{ required: true, message: '请填写数据库密码' }]"
              >
                <Input.Password
                  v-model:value="db.password"
                  autocomplete="new-password"
                  placeholder="只在此页面输入"
                  :disabled="dbBusy"
                />
              </Form.Item>
            </div>
            <Form.Item
              v-if="db.tlsMode === 'ssl'"
              label="RDS CA证书（服务器不能验证证书时需要）"
            >
              <input
                type="file"
                accept=".pem,.crt,.cer"
                aria-label="上传RDS CA证书"
                :disabled="dbBusy"
                @change="uploadCA"
              />
              <p class="hci-subtle">
                {{
                  caName ||
                  '从 RDS SSL 页面下载证书，解压后选择 CA 证书文件。系统始终校验证书，不使用明文连接。'
                }}
              </p>
            </Form.Item>
            <div class="admin-row-actions">
              <Button html-type="submit" :loading="dbBusy">
                验证数据库连接 </Button
              ><Button
                type="primary"
                :disabled="!dbVerified || dbBusy"
                @click="migrateOpen = true"
              >
                备份并迁移到 MySQL
              </Button>
            </div>
          </Form>
        </template>
        <p v-if="dbMessage" class="hci-evidence" role="status">
          {{ dbMessage }}
        </p>
        <p v-if="database.engine === 'mysql'" class="hci-subtle">
          连接方式：{{
            database.connectionMode === 'plain'
              ? '普通连接（未加密传输）'
              : 'SSL 加密连接'
          }}
        </p>
        <p class="hci-subtle">
          迁移包含关键词、任务、站点、商品、数据源配置和账号。逐表核对记录数量与内容后切换，原数据库保留供回退；目标库已有本系统数据时不会覆盖。
        </p>
      </section>
      <section class="hci-panel">
        <div class="hci-panel-head">
          <h2>账号操作记录</h2>
          <Button :loading="busy" @click="run(load)">刷新</Button>
        </div>
        <Table
          :data-source="events"
          :pagination="{ pageSize: 10 }"
          :columns="[
            { title: '时间', key: 'at' },
            { title: '操作人', dataIndex: 'username' },
            { title: '操作', dataIndex: 'action' },
          ]"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'at'">
              {{ date(record.at) }}
            </template>
          </template>
        </Table>
      </section>
    </template>
    <Modal
      v-model:open="createOpen"
      title="新增账号"
      :confirm-loading="busy"
      ok-text="创建账号"
      @ok="createUser"
      @cancel="newUser.password = ''"
    >
      <Form layout="vertical">
        <Form.Item label="账号">
          <Input
            v-model:value="newUser.username"
            autocomplete="off"
            placeholder="3～64位英文、数字、点、下划线或短横线"
          /> </Form.Item
        ><Form.Item label="姓名">
          <Input v-model:value="newUser.displayName" /> </Form.Item
        ><Form.Item label="角色">
          <Select
            v-model:value="newUser.role"
            :options="roleOptions"
          /> </Form.Item
        ><Form.Item label="初始密码">
          <Input.Password
            v-model:value="newUser.password"
            autocomplete="new-password"
            placeholder="8～128个字符"
          />
        </Form.Item> </Form
      ><Alert v-if="error" :message="error" type="error" />
    </Modal>
    <Modal
      :open="Boolean(resetUser)"
      :title="`重设 ${resetUser?.username || ''} 的密码`"
      :confirm-loading="busy"
      ok-text="重设密码"
      @ok="saveReset"
      @cancel="
        resetUser = undefined;
        resetPassword = '';
      "
    >
      <Form layout="vertical">
        <Form.Item label="新密码">
          <Input.Password
            v-model:value="resetPassword"
            autocomplete="new-password"
            placeholder="8～128个字符"
          />
        </Form.Item> </Form
      ><Alert v-if="error" :message="error" type="error" />
    </Modal>
    <Modal
      v-model:open="migrateOpen"
      title="迁移到独立数据库"
      ok-text="开始备份与迁移"
      @ok="migrateDatabase"
    >
      <p>
        将现有业务数据和账号完整复制到阿里云 leo
        数据库，备份并逐表校验后切换。原数据库保留，目标数据库已有本系统数据时停止。
      </p>
      <p>迁移期间暂时停止读写，完成后页面会自动刷新。</p>
    </Modal>
  </main>
</template>
<style scoped>
.admin-password-form {
  max-width: 440px;
  margin-top: 24px;
}
.admin-db-form {
  max-width: 850px;
  margin-top: 24px;
}
.admin-row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
</style>
