import _, { toNumber, mapValues, isArray, isPlainObject, set } from 'lodash';
import dayjs from 'dayjs';
import produce from 'immer';
import 'dayjs/locale/zh-cn';
import isLeapYear from 'dayjs/plugin/isLeapYear';
import relativeTime from 'dayjs/plugin/relativeTime';
import LocalizedFormat from 'dayjs/plugin/localizedFormat';
import { isProxy, reactive, toRaw } from '@vue/reactivity';
import { watch } from '../utils/watchReactivity';
import {
  isNumeric,
  parseExpression,
  consoleError,
  ConsoleType,
  ExpChunk,
} from '@sunmao-ui/shared';
import { type PropsAfterEvaled } from '@sunmao-ui/core';

dayjs.extend(relativeTime);
dayjs.extend(isLeapYear);
dayjs.extend(LocalizedFormat);
dayjs.locale('zh-cn');

type EvalOptions = {
  evalListItem?: boolean;
  scopeObject?: Record<string, any>;
  overrideScope?: boolean;
  fallbackWhenError?: (exp: string) => any;
  ignoreEvalError?: boolean;
  slotKey?: string;
};

// TODO: use web worker
const DefaultDependencies = {
  dayjs,
  _,
};

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

export type StateManagerInterface = InstanceType<typeof StateManager>;

export class StateManager {
  store = reactive<Record<string, any>>({});
  slotStore = reactive<Record<string, any>>({});

  dependencies: Record<string, unknown>;

  // when ignoreEvalError is true, the eval process will continue after error happens in nests expression.
  noConsoleError = false;

  constructor(dependencies: Record<string, unknown> = {}) {
    this.dependencies = { ...DefaultDependencies, ...dependencies };
  }

  clear = () => {
    this.store = reactive<Record<string, any>>({});
  };

  evalExp = (expChunk: ExpChunk, options: EvalOptions): unknown => {
    if (typeof expChunk === 'string') {
      return expChunk;
    }

    const { scopeObject = {}, overrideScope = false, ignoreEvalError = false } = options;
    const evalText = expChunk.map(ex => this.evalExp(ex, { scopeObject })).join('');

    try {
      // eslint-disable-next-line no-useless-call, no-new-func
      const evaled = new Function(
        'store, dependencies, scopeObject',
        // trim leading space and newline
        `with(store) { with(dependencies) { with(scopeObject) { return ${evalText.replace(
          /^\s+/g,
          ''
        )} } } }`
      ).call(
        null,
        overrideScope ? {} : this.store,
        overrideScope ? {} : this.dependencies,
        scopeObject
      );

      return evaled;
    } catch (error) {
      if (ignoreEvalError) {
        // convert it to expression and return
        return `{{${evalText}}}`;
      }
      throw error;
    }
  };

  maskedEval(raw: string, options: EvalOptions = {}): unknown | ExpressionError {
    const { evalListItem = false, fallbackWhenError } = options;
    let result: unknown[] = [];

    try {
      if (isNumeric(raw)) {
        return toNumber(raw);
      }
      if (raw === 'true') {
        return true;
      }
      if (raw === 'false') {
        return false;
      }
      const expChunk = parseExpression(raw, evalListItem);

      if (typeof expChunk === 'string') {
        return expChunk;
      }

      result = expChunk.map(e => this.evalExp(e, options));

      if (result.length === 1) {
        return result[0];
      }
      return result.join('');
    } catch (error) {
      if (error instanceof Error) {
        const expressionError = new ExpressionError(error.message);

        if (!this.noConsoleError) {
          consoleError(ConsoleType.Expression, '', expressionError.message);
        }

        return fallbackWhenError ? fallbackWhenError(raw) : expressionError;
      }
      return undefined;
    }
  }

  mapValuesDeep<T extends object>(
    obj: T,
    fn: (params: {
      value: T[keyof T];
      key: string | number;
      obj: T;
      path: Array<string | number>;
    }) => void,
    path: Array<string | number> = []
  ): PropsAfterEvaled<T> {
    return mapValues(obj, (val, key: string | number) => {
      return isArray(val)
        ? val.map((innerVal, idx) => {
            return isPlainObject(innerVal)
              ? this.mapValuesDeep(innerVal, fn, path.concat(key, idx))
              : fn({ value: innerVal, key, obj, path: path.concat(key, idx) });
          })
        : isPlainObject(val)
        ? this.mapValuesDeep(val as unknown as T, fn, path.concat(key))
        : fn({ value: val, key, obj, path: path.concat(key) });
    }) as PropsAfterEvaled<T>;
  }

  deepEval<T extends Record<string, unknown> | any[]>(
    obj: T,
    options: EvalOptions = {}
  ): PropsAfterEvaled<T> {
    const store = this.slotStore;
    const redirector = new Proxy(
      {},
      {
        get(_, prop) {
          return options.slotKey ? store[options.slotKey][prop] : undefined;
        },
      }
    );
    // just eval
    const evaluated = this.mapValuesDeep(obj, ({ value }) => {
      if (typeof value !== 'string') {
        return value;
      }
      options.scopeObject = {
        ...options.scopeObject,
        $slot: redirector,
      };
      return this.maskedEval(value, options);
    });

    return evaluated;
  }

  deepEvalAndWatch<T extends Record<string, unknown> | any[]>(
    obj: T,
    watcher: (params: { result: PropsAfterEvaled<T> }) => void,
    options: EvalOptions = {}
  ) {
    const stops: ReturnType<typeof watch>[] = [];

    // just eval
    const evaluated = this.deepEval(obj, options);

    const store = this.slotStore;
    const redirector = new Proxy(
      {},
      {
        get(_, prop) {
          return options.slotKey ? store[options.slotKey][prop] : undefined;
        },
      }
    );
    // watch change
    let resultCache: PropsAfterEvaled<T> = evaluated;
    this.mapValuesDeep(obj, ({ value, path }) => {
      const isDynamicExpression =
        typeof value === 'string' &&
        parseExpression(value).some(exp => typeof exp !== 'string');

      if (!isDynamicExpression) return;

      const stop = watch(
        () => {
          options.scopeObject = {
            ...options.scopeObject,
            $slot: redirector,
          };
          const result = this.maskedEval(value as string, options);

          return result;
        },
        newV => {
          if (isProxy(newV)) {
            newV = toRaw(newV);
          }
          resultCache = produce(resultCache, draft => {
            set(draft, path, newV);
          });
          watcher({ result: resultCache });
        },
        {
          deep: true,
        }
      );
      stops.push(stop);
    });

    return {
      result: evaluated,
      stop: () => stops.forEach(s => s()),
    };
  }

  setDependencies(dependencies: Record<string, unknown> = {}) {
    this.dependencies = { ...DefaultDependencies, ...dependencies };
  }
}
