import * as Yup from 'yup';
import { startOfHour, parseISO, isBefore, format, subHours } from 'date-fns';
import pt from 'date-fns/locale/pt';

import Notification from '../schemas/Notification';
import Appointment from '../models/Appointment';
import User from '../models/User';
import File from '../models/File';
import Mail from '../../lib/Mail';

class AppointmentController {
    async index(req, res) {
        const { page } = req.query;

        const appointments = await Appointment.findAll({
            where: { user_id: req.userId, canceled_at: null },
            order: ['date'],
            attributes: ['id', 'date'],
            limit: 20,
            offset: (page - 1) * 20,
            include: [
                {
                    model: User,
                    as: 'provider',
                    attributes: ['id', 'name'],
                    include: [
                        {
                            model: File,
                            as: 'avatar',
                            attributes: ['id', 'path', 'url'],
                        },
                    ],
                },
            ],
        });

        return res.json(appointments);
    }

    async store(req, res) {
        const schema = Yup.object().shape({
            provider_id: Yup.number().required(),
            date: Yup.date().required(),
        });

        if (!(await schema.isValid(req.body))) {
            return res.status(400).json({ error: 'Validation failed' });
        }

        const { provider_id, date } = req.body;

        // Check if provider exists
        const checkIsProvider = await User.findOne({
            where: { id: provider_id, provider: true },
        });

        if (!checkIsProvider) {
            return res.status(400).json({
                error: 'You can only create appointments with a provider',
            });
        }

        // Check hour availability
        const hourStart = startOfHour(parseISO(date));

        if (isBefore(hourStart, new Date())) {
            return res
                .status(400)
                .json({ error: 'Past dates are not permited' });
        }

        const checkAvailability = await Appointment.findOne({
            where: {
                provider_id,
                canceled_at: null,
                date: hourStart,
            },
        });

        if (checkAvailability) {
            return res
                .status(400)
                .json({ error: 'Appointment date is not available' });
        }

        const appointment = await Appointment.create({
            user_id: req.userId,
            provider_id,
            date: hourStart,
        });

        const user = await User.findByPk(req.userId);
        const formatedDate = format(
            hourStart,
            "'dia 'dd' de 'MMMM', às 'H:mm'hrs'",
            { locale: pt }
        );

        // Notify appointment to provider
        await Notification.create({
            content: `Novo agendamento para ${user.name} no ${formatedDate}`,
            user: provider_id,
        });

        return res.json(appointment);
    }

    async delete(req, res) {
        const appointment = await Appointment.findByPk(req.params.id, {
            include: [
                {
                    model: User,
                    as: 'provider',
                    attributes: ['name', 'email'],
                },
            ],
        });

        if (appointment.user_id !== req.userId) {
            return res.status(401).json({
                error: 'You cannot cancel this appointment',
            });
        }

        const dateWithSub = subHours(appointment.date, 2);

        if (isBefore(dateWithSub, new Date())) {
            return res.status(401).json({
                error:
                    'You can only cancel appointments with 2 hours in advance',
            });
        }

        if (appointment.canceled_at !== null) {
            return res.status(401).json({
                error: 'That appointment has already been canceled',
            });
        }

        appointment.canceled_at = new Date();

        await appointment.save();

        await Mail.sendMail({
            to: `${appointment.provider.name} <${appointment.provider.email}>`,
            subject: 'Agendamento cancelado',
            text: 'Você tem um novo cancelamento',
        });

        return res.json(appointment);
    }
}

export default new AppointmentController();
