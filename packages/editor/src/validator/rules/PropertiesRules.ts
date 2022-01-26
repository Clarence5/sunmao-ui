import { get, has } from 'lodash-es';
import { ComponentId } from '../../AppModel/IAppModel';
import {
  PropertiesValidatorRule,
  PropertiesValidateContext,
  ValidateErrorResult,
} from '../interfaces';

class PropertySchemaValidatorRule implements PropertiesValidatorRule {
  kind: 'properties' = 'properties';

  validate({
    properties,
    component,
    trait,
    validators,
  }: PropertiesValidateContext): ValidateErrorResult[] {
    const results: ValidateErrorResult[] = [];
    let validate

    if (trait) {
      validate = validators.traits[trait.type]
    } else {
      validate = validators.components[component.type];
    }

    if (!validate) return results;

    const valid = validate(properties.rawValue);
    if (valid) return results;
    validate.errors!.forEach(error => {
      // todo: detect deep error 
      const { instancePath, params } = error;
      let key = '';
      if (instancePath) {
        key = instancePath.split('/')[1];
      } else {
        key = params.missingProperty;
      }
      const fieldModel = properties.getProperty(key);
      // if field is expression, ignore type error
      // fieldModel could be undefiend. if is undefined, still throw error.
      if (get(fieldModel, 'isDynamic') !== true) {
        results.push({
          message: error.message || '',
          componentId: component.id,
          property: error.instancePath,
          traitType: trait?.type,
        });
      }
    });

    return results;
  }
}

class ExpressionValidatorRule implements PropertiesValidatorRule {
  kind: 'properties' = 'properties';

  validate({
    properties,
    component,
    trait,
    appModel,
  }: PropertiesValidateContext): ValidateErrorResult[] {
    const results: ValidateErrorResult[] = [];

    // validate expression
    properties.traverse((fieldModel, key) => {
      Object.keys(fieldModel.refs).forEach((id: string) => {
        const targetComponent = appModel.getComponentById(id as ComponentId);
        if (!targetComponent) {
          results.push({
            message: `Cannot find '${id}' in store.`,
            componentId: component.id,
            property: key,
            traitType: trait?.type,
          });
        } else {
          const paths = fieldModel.refs[id as ComponentId];
          paths.forEach(path => {
            if (!has(targetComponent.stateExample, path)) {
              results.push({
                message: `Component '${id}' does not have property '${path}'.`,
                componentId: component.id,
                property: key,
                traitType: trait?.type,
              });
            }
          });
        }
      });
    });

    return results;
  }
}
export const PropertiesRules = [new PropertySchemaValidatorRule(), new ExpressionValidatorRule()];