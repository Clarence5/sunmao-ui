import { ApplicationComponent, ComponentTrait } from '@meta-ui/core';
import { HStack, IconButton, VStack } from '@chakra-ui/react';
import { parseTypeBox } from '@meta-ui/runtime';
import { CloseIcon } from '@chakra-ui/icons';
import { TSchema } from '@sinclair/typebox';
import { renderField } from '../ComponentForm';
import { formWrapperCSS } from '../style';
import { registry } from '../../../metaUI';

type Props = {
  component: ApplicationComponent;
  trait: ComponentTrait;
  onRemove: () => void;
};

export const GeneralTraitForm: React.FC<Props> = props => {
  const { trait, component, onRemove } = props;

  const tImpl = registry.getTraitByType(trait.type);
  const properties = Object.assign(
    parseTypeBox(tImpl.spec.properties as TSchema),
    trait.properties
  );

  const fields = Object.keys(properties || []).map((key: string) => {
    const value = trait.properties[key];
    return renderField({
      key,
      value,
      fullKey: key,
      type: trait.type,
      selectedId: component.id,
    });
  });
  return (
    <VStack key={trait.type} css={formWrapperCSS}>
      <HStack width="full" justifyContent="space-between">
        <strong>{trait.type}</strong>
        <IconButton
          aria-label="remove trait"
          variant="ghost"
          colorScheme="red"
          size="xs"
          icon={<CloseIcon />}
          onClick={onRemove}
        />
      </HStack>
      {fields}
    </VStack>
  );
};
