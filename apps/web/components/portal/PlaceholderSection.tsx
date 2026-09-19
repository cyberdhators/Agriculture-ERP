import { ButtonLink, Card, CardBody, EmptyState, PageHeader } from '../ui';

/**
 * A section that belongs to another unit. It is here so the navigation has
 * the shape of the finished portal; it says which unit builds it and where a
 * reader can go now.
 */
export function PlaceholderSection({
  title,
  unit,
  body,
}: {
  title: string;
  unit: string;
  body: string;
}) {
  return (
    <>
      <PageHeader eyebrow="Not yet built" title={title} subtitle={unit} />
      <Card>
        <CardBody>
          <EmptyState
            title={`${title} is not available yet`}
            body={body}
            actions={
              <>
                {/*
                 * Pointed at the register rather than the directories: that
                 * destination is no longer part of the redesigned
                 * administrator experience. Nothing imports this component
                 * today, so the link renders nowhere — changed so a revival
                 * cannot quietly reintroduce the destination.
                 */}
                <ButtonLink href="/farmers" variant="secondary">
                  Open the register
                </ButtonLink>
                <ButtonLink href="/library" variant="ghost">
                  Open learning library
                </ButtonLink>
              </>
            }
          />
        </CardBody>
      </Card>
    </>
  );
}
