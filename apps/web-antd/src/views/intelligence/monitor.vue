<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Button,
  Tabs,
  Table,
  Tag,
  Switch,
  Select,
  Drawer,
  Empty,
} from 'ant-design-vue';
import PageHeader from './components/PageHeader.vue';
import { state, inMarket, audit, marketName } from './data';
import type { Task } from './data';
const route = useRoute();
const router = useRouter();
const tab = ref('monitors');
const selected = ref<Task>();
watch(
  () => route.query.tab,
  (v) => {
    if (v === 'tasks') tab.value = 'tasks';
  },
  { immediate: true },
);
const monitors = computed(() =>
  state.monitors.filter((m) =>
    inMarket(state.products.find((p) => p.id === m.productId)!.market),
  ),
);
const tasks = computed(() => state.tasks.filter((t) => inMarket(t.market)));
function run(task: Task) {
  task.status = 'partial';
  task.steps = [
    '演示配置校验通过',
    '演示关键词阶段完成',
    '演示趋势阶段完成',
    '演示站点阶段完成',
    '真实数据源未接入：部分完成',
  ];
  audit('模拟研究执行', task.title, task.market);
}
function cancel(task: Task) {
  task.status = 'cancelled';
  audit('取消演示任务', task.title, task.market);
}
watch(
  () => state.market,
  () => {
    selected.value = undefined;
  },
);
const auditRows = computed(() =>
  state.audit.filter(
    (e) => state.market === 'ALL' || e.market === state.market,
  ),
);
const statuses = {
  queued: '待执行',
  completed: '已完成',
  partial: '部分完成',
  cancelled: '已取消',
};
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="监控与任务"
      description="让重点对象持续可见，让每个研究步骤都有明确状态。"
      ><Button type="primary" @click="router.push('/research?new=1')"
        >＋ 新建研究</Button
      ></PageHeader
    >
    <div class="hci-demo-note">
      当前监控配置仅保存在浏览器，尚无后台定时采集。任务可手动模拟执行，用于体验进度、取消和重试。
    </div>
    <section class="hci-panel">
      <Tabs v-model:active-key="tab"
        ><Tabs.TabPane key="monitors" :tab="`重点监控（${monitors.length}）`"
          ><Table
            :data-source="monitors"
            row-key="id"
            :pagination="false"
            :scroll="{ x: 650 }"
            :columns="[
              { title: '监控商品', key: 'product' },
              { title: '周期', key: 'frequency' },
              { title: '监控字段', key: 'fields' },
              { title: '状态', key: 'status' },
            ]"
            ><template #bodyCell="{ column, record }"
              ><template v-if="column.key === 'product'"
                ><b>{{
                  state.products.find((p) => p.id === record.productId)?.title
                }}</b>
                <p class="hci-subtle">
                  {{
                    state.products.find((p) => p.id === record.productId)?.brand
                  }}
                </p></template
              ><template v-if="column.key === 'frequency'"
                ><Select
                  v-model:value="record.frequency"
                  :options="
                    ['每天', '每两天', '每周'].map((v) => ({
                      label: v,
                      value: v,
                    }))
                  "
                  style="width: 110px"
                  @change="
                    audit(
                      '修改演示监控频率',
                      record.productId,
                      state.products.find((p) => p.id === record.productId)
                        ?.market,
                    )
                  " /></template
              ><template v-if="column.key === 'fields'"
                >价格 / 库存状态 / 配方</template
              ><template v-if="column.key === 'status'"
                ><Switch
                  v-model:checked="record.enabled"
                  checked-children="开启"
                  un-checked-children="暂停"
                  @change="
                    audit(
                      '调整演示监控状态',
                      record.productId,
                      state.products.find((p) => p.id === record.productId)
                        ?.market,
                    )
                  " /></template></template></Table></Tabs.TabPane
        ><Tabs.TabPane key="tasks" :tab="`研究任务（${tasks.length}）`"
          ><Empty v-if="!tasks.length" description="暂无任务" />
          <div v-for="task in tasks" :key="task.id" class="hci-source-card">
            <div class="hci-source-info">
              <h3>{{ task.title }}</h3>
              <p class="hci-subtle">
                {{ marketName(task.market) }} · {{ task.created }}
              </p>
            </div>
            <Tag
              :color="
                task.status === 'partial'
                  ? 'orange'
                  : task.status === 'completed'
                    ? 'green'
                    : 'default'
              "
              >{{ statuses[task.status] }}</Tag
            ><Button size="small" @click="selected = task">详情</Button
            ><Button
              v-if="task.status === 'queued'"
              size="small"
              type="primary"
              @click="run(task)"
              >模拟执行</Button
            ><Button
              v-if="task.status === 'queued'"
              size="small"
              @click="cancel(task)"
              >取消</Button
            ><Button
              v-if="task.status === 'cancelled' || task.status === 'partial'"
              size="small"
              @click="
                task.status = 'queued';
                audit('重试演示任务', task.title, task.market);
              "
              >重试</Button
            >
          </div></Tabs.TabPane
        ><Tabs.TabPane key="audit" :tab="`操作记录（${auditRows.length}）`"
          ><Empty
            v-if="!auditRows.length"
            description="收藏、审核或修改监控后，会在这里留下记录"
          />
          <div
            v-for="event in auditRows"
            :key="event.id"
            class="hci-market-row"
          >
            <div>
              <b>{{ event.title }}</b>
              <p class="hci-subtle">{{ event.detail }}</p>
            </div>
            <span class="hci-subtle">{{ event.at }}</span>
          </div></Tabs.TabPane
        ></Tabs
      >
    </section>
    <Drawer
      :open="!!selected"
      title="研究任务详情"
      :width="560"
      @close="selected = undefined"
      ><template v-if="selected"
        ><h2 style="font-size: 22px">{{ selected.title }}</h2>
        <p class="hci-subtle" style="margin: 12px 0">
          {{ selected.created }} · {{ statuses[selected.status] }}
        </p>
        <div
          v-for="(step, i) in selected.steps"
          :key="i"
          class="hci-market-row"
        >
          <span class="hci-market-code">{{ i + 1 }}</span
          ><span style="flex: 1">{{ step }}</span>
        </div>
        <div class="hci-evidence">
          本任务仅模拟工作流，没有向第三方平台发出请求，也没有产生真实研究结果或费用。
        </div>
        <Button @click="router.push('/research')"
          >查看演示关键词</Button
        ></template
      ></Drawer
    >
  </main>
</template>
