import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function fixture(fileName: string): string {
  return readFileSync(new URL(`./fixtures/${fileName}`, import.meta.url), 'utf8')
}

export default defineConfig({
  base: '/demos/bom-quote-review/',
  plugins: [react()],
  define: {
    __DEMO_BOM_RAW_TEXT__: JSON.stringify(fixture('customer-bom.csv')),
    __DEMO_YUNFAN_RAW_TEXT__: JSON.stringify(fixture('supplier-01-yunfan.csv')),
    __DEMO_XINGHE_RAW_TEXT__: JSON.stringify(
      fixture('supplier-02-xinghe-email.txt'),
    ),
    __DEMO_LINGFENG_RAW_TEXT__: JSON.stringify(
      fixture('supplier-03-lingfeng.json'),
    ),
    __DEMO_JIAZHUN_RAW_TEXT__: JSON.stringify(
      fixture('supplier-04-jiazhun.csv'),
    ),
  },
})
