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
            title={`${title} is not part of this preview`}
            body={body}
            actions={
              <>
                <ButtonLink href="/directories" variant="secondary">
                  Open directories
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
