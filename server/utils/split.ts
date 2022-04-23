import { Observable } from 'rxjs';

export const split = (pattern: RegExp) => (observable: Observable<string>) => {
	let buffer = '';

	return new Observable<string>((subscriber) => {
		observable.subscribe({
			next(chunk) {
				const lines = (buffer + chunk).split(pattern);
				buffer = lines.pop() || '';

				lines.forEach((line) => {
					subscriber.next(line);
				});
			},
			error: (err) => subscriber.error(err),
			complete: () => {
				if (buffer) {
					subscriber.next(buffer);
				}
				subscriber.complete();
			},
		});
	});
};
