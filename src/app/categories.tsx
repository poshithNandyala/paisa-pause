import React, { useState } from 'react';
import { View } from 'react-native';
import type { Category } from '../domain/types';
import { UNCATEGORIZED_ID } from '../domain/types';
import { useReady } from '../state/store';
import { Body, Button, Card, Field, Muted, Pill, RowWrap, Screen } from '../ui/kit';
import { SPACE } from '../ui/theme';

export default function Categories() {
  const { snapshot, actions } = useReady();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const list = [...snapshot.categories].filter((c) => !c.archived).sort((a, b) => a.sort - b.sort);

  async function rename(c: Category) {
    const n = name.trim();
    if (!n) return;
    await actions.saveCategory({ ...c, name: n });
    setEditing(null);
  }

  return (
    <Screen>
      <Muted>Rename or hide categories. Hidden ones disappear from pickers but old entries keep them, so history stays correct.</Muted>
      {list.map((c) => (
        <Card key={c.id}>
          {editing === c.id ? (
            <View style={{ gap: SPACE.sm }}>
              <Field label="Name" value={name} onChangeText={setName} maxLength={40} />
              <RowWrap>
                <Button label="Save" compact onPress={() => rename(c)} />
                <Button label="Cancel" kind="quiet" compact onPress={() => setEditing(null)} />
              </RowWrap>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
                <Body style={{ flex: 1, fontWeight: '600' }}>{c.name}</Body>
                {c.hidden ? <Pill text="Hidden" /> : null}
              </View>
              <RowWrap>
                <Button
                  label="Rename"
                  kind="quiet"
                  compact
                  onPress={() => {
                    setEditing(c.id);
                    setName(c.name);
                  }}
                />
                {c.id !== UNCATEGORIZED_ID ? (
                  <Button label={c.hidden ? 'Show' : 'Hide'} kind="quiet" compact onPress={() => actions.saveCategory({ ...c, hidden: !c.hidden })} />
                ) : null}
              </RowWrap>
            </>
          )}
        </Card>
      ))}
      {adding ? (
        <Card>
          <Field label="New category name" value={newName} onChangeText={setNewName} maxLength={40} />
          <RowWrap>
            <Button
              label="Add"
              compact
              disabled={!newName.trim()}
              onPress={async () => {
                await actions.saveCategory({
                  id: actions.newId(),
                  name: newName.trim(),
                  hidden: false,
                  archived: false,
                  sort: Math.max(0, ...snapshot.categories.filter((c) => c.id !== UNCATEGORIZED_ID).map((c) => c.sort)) + 1,
                  builtin: false,
                  createdAt: Date.now(),
                });
                setAdding(false);
                setNewName('');
              }}
            />
            <Button label="Cancel" kind="quiet" compact onPress={() => setAdding(false)} />
          </RowWrap>
        </Card>
      ) : (
        <Button label="Add a category" kind="secondary" onPress={() => setAdding(true)} />
      )}
    </Screen>
  );
}
