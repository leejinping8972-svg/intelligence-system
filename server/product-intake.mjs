import { createHash } from 'node:crypto';
import { mergePlatformProduct } from './platform-product-data.mjs';
import { intakeSourceWork } from './product-intake-sorftime.mjs';
import { sourceFieldSample } from './source-field-domain.mjs';

const digest = (value) =>
  createHash('sha256').update(value).digest('hex').slice(0, 24);

// Every external step uses the existing request journal. A resumed task reuses
// completed responses and never repeats an unknown paid request.
export async function prepareProductIntake(job, original, io, options = {}) {
  let product = original;
  const errors = [];
  const key = `intake:${digest(original.id)}`;
  if (options.legacyAnalysisStep && io.pool) {
    const previous = (
      await io.pool.query(
        "SELECT status,error FROM research_requests WHERE job_id=$1 AND step=$2 AND status<>'done' LIMIT 1",
        [job.id, options.legacyAnalysisStep],
      )
    ).rows[0];
    if (previous?.status)
      return {
        product,
        errors: [
          previous.error || '此前商品分析结果未知，未发起新的来源或AI请求',
        ],
      };
  }
  const request = async (step, input) => {
    await io.beforeIntake?.(step, input);
    const result = await io.collect(job, step, input);
    await io.afterIntake?.(step, input, result);
    return result;
  };
  if (options.sourceDetails !== false) {
    for (const work of intakeSourceWork(product)) {
      if (options.detailLoaded && work.op === 'detail') continue;
      if (await io.isCancelled?.()) break;
      try {
        const result = await request(`${key}:${work.op}`, {
          sources: ['product_intake_source'],
          provider: 'sorftime',
          sorftimeRequestLimit: 1,
          ...work,
          product,
        });
        if (result.product || result.patch)
          product = mergePlatformProduct(
            product,
            result.product || { ...result.patch, id: product.id },
          );
      } catch (error) {
        errors.push(`${work.op}：${String(error.message).slice(0, 350)}`);
      }
    }
  }
  const sample = sourceFieldSample('products', product);
  if (
    product.fieldAnalysis?.version === 2 &&
    product.fieldAnalysis.status === 'analyzed' &&
    product.fieldAnalysis.fingerprint === sample.fingerprint
  )
    return { product: io.translate ? (await io.translate('products', [product]))[0] : product, analysis: product.fieldAnalysis, errors };
  if (await io.isCancelled?.()) return { product, errors, cancelled: true };
  try {
    const result = await request(
      `${key}:fields:${sample.fingerprint.slice(0, 24)}`,
      { sources: ['field_analysis'], sample },
    );
    if (!result.analysis || result.analysis.status !== 'analyzed')
      throw Error('AI未返回有效字段分析，原始资料已保留');
    const patch = result.patch || {};
    product = {
      ...product,
      ...patch,
      // Missing AI fields must not erase usable source values.
      collectionFields: [
        ...new Set([
          ...(product.collectionFields || []),
          ...Object.keys(patch).filter((k) => !k.endsWith('Zh')),
        ]),
      ],
      fieldAnalysis: {
        ...result.analysis,
        version: 2,
        model: result.model,
        sources: sample.sources,
      },
    };
    if (io.translate) [product] = await io.translate('products', [product]);
    return { product, analysis: product.fieldAnalysis, errors };
  } catch (error) {
    errors.push(`AI：${String(error.message).slice(0, 350)}`);
    return {
      product: {
        ...product,
        fieldAnalysis: {
          version: 2,
          status: 'pending',
          fingerprint: sample.fingerprint,
          sources: sample.sources,
        },
      },
      errors,
    };
  }
}
