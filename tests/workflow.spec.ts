import { test, expect } from '@playwright/test';

test('Personal workspace opens without authentication', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '放入录音，接下来交给听录。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /工单/ })).toHaveCount(0);
  await expect(page.getByLabel(/识别模型/)).toBeVisible();
  await expect(page.getByRole('button', { name: '上传并开始转写', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '我的记录', exact: true }).click();
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeVisible();
});
